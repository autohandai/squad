#!/usr/bin/env node
// Autohand Squad relay: a small self-hosted service that stores shared channel
// state for a workspace and fans out changes to connected bridges.
//
//   node relay/server.mjs --port 8787 --data ./relay-data [--host 0.0.0.0]
//
// Auth: every request carries `Authorization: Bearer <token>` (WebSocket
// clients may also pass `?token=`). With RELAY_VERIFY_ACCOUNTS=1 the token is
// an Autohand account token, verified against https://api.autohand.ai/v1/profile
// (override with RELAY_ACCOUNT_API). Otherwise RELAY_TOKENS lists accepted
// tokens: "igor:tok-1,noah:tok-2" (name:token) or bare tokens.
//
// REST (JSON envelope { success, data } | { success, error }):
//   GET  /v1/health
//   GET  /v1/workspaces/:ws/channels
//   PUT  /v1/workspaces/:ws/channels                 { channels: [...] }  (LWW merge)
//   GET  /v1/workspaces/:ws/channels/:id/messages?since=<ISO>&limit=
//   POST /v1/workspaces/:ws/channels/:id/messages    { id, body, updatedAt, ... } (LWW)
//   GET  /v1/workspaces/:ws/messages?since=<ISO>     (all channels)
//   GET  /v1/workspaces/:ws/presence
// WebSocket /v1/workspaces/:ws/stream fans out
//   { type: "hello", person, people }               once, on connect
//   { type: "message", workspace, message }         a stored message changed
//   { type: "channel", workspace, channel }         a stored channel changed
//   { type: "presence", workspace, people }         someone joined or left
// A client may send { type: "ping" } and receives { type: "pong" }.
//
// Storage is relay/store.mjs (JSON files); swap it for Postgres by keeping
// the same method contract. No npm dependencies.

import http from "node:http";
import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { createStore, normalizeWorkspaceId } from "./store.mjs";
import { acceptWebSocket, rejectWebSocket } from "./ws.mjs";

const DEFAULT_ACCOUNT_API = "https://api.autohand.ai/v1/profile";
const PROFILE_CACHE_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export function parseTokens(value) {
  const people = new Map();
  for (const entry of String(value || "").split(",")) {
    const raw = entry.trim();
    if (!raw) continue;
    const split = raw.indexOf(":");
    const name = split > 0 ? raw.slice(0, split).trim() : "";
    const token = split > 0 ? raw.slice(split + 1).trim() : raw;
    if (!token) continue;
    const id = (name || `person-${createHash("sha256").update(token).digest("hex").slice(0, 8)}`).toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
    people.set(token, { id, name: name || id });
  }
  return people;
}

function bearerFrom(req, url) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1].trim();
  return String(url?.searchParams.get("token") || "").trim();
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) {
        resolvePromise({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolvePromise(parsed && typeof parsed === "object" ? parsed : {});
      } catch {
        reject(Object.assign(new Error("body must be JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function createAuthenticator({ tokens, verifyAccounts, accountApi, fetchImpl = globalThis.fetch }) {
  const people = parseTokens(tokens);
  const profileCache = new Map(); // token hash -> { person, expiresAt }

  async function verifyAccount(token) {
    const key = createHash("sha256").update(token).digest("hex");
    const cached = profileCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.person;
    let person = null;
    try {
      const response = await fetchImpl(accountApi, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      if (response.ok) {
        const payload = await response.json().catch(() => ({}));
        const profile = payload?.data && typeof payload.data === "object" ? payload.data : payload?.user && typeof payload.user === "object" ? payload.user : payload;
        const email = String(profile?.email || "").trim();
        const id = String(profile?.id || profile?.userId || email || "").trim();
        if (id) person = { id, name: String(profile?.name || profile?.displayName || email || id).trim(), email };
      }
    } catch {
      person = null;
    }
    if (person) profileCache.set(key, { person, expiresAt: Date.now() + PROFILE_CACHE_MS });
    return person;
  }

  return async function authenticate(token) {
    if (!token) return null;
    if (verifyAccounts) return verifyAccount(token);
    return people.get(token) || null;
  };
}

export async function startRelay({
  port = 8787,
  host = "127.0.0.1",
  dataDir = "./relay-data",
  tokens = process.env.RELAY_TOKENS || "",
  verifyAccounts = process.env.RELAY_VERIFY_ACCOUNTS === "1",
  accountApi = process.env.RELAY_ACCOUNT_API || DEFAULT_ACCOUNT_API,
  fetchImpl,
  log = () => {},
  store = createStore({ dataDir: resolve(dataDir) }),
} = {}) {
  if (!verifyAccounts && !String(tokens).trim()) {
    throw new Error("set RELAY_TOKENS (name:token,...) or RELAY_VERIFY_ACCOUNTS=1");
  }
  const authenticate = createAuthenticator({ tokens, verifyAccounts, accountApi, fetchImpl });
  const rooms = new Map(); // ws -> Set<connection>
  let connectionSeq = 0;

  function presenceOf(ws) {
    const byPerson = new Map();
    for (const connection of rooms.get(ws) || []) {
      const { person, since } = connection.meta;
      const entry = byPerson.get(person.id) || { id: person.id, name: person.name, connections: 0, since };
      entry.connections += 1;
      if (since < entry.since) entry.since = since;
      byPerson.set(person.id, entry);
    }
    return Array.from(byPerson.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  function broadcast(ws, event) {
    const payload = JSON.stringify({ workspace: ws, ...event, at: new Date().toISOString() });
    for (const connection of rooms.get(ws) || []) connection.send(payload);
  }

  function route(url) {
    const match = url.pathname.match(/^\/v1\/workspaces\/([^/]+)(\/.*)?$/);
    if (!match) return null;
    const ws = normalizeWorkspaceId(decodeURIComponent(match[1]));
    if (!ws) return { error: "workspace id must be lowercase letters, digits, dots, dashes or underscores" };
    return { ws, rest: match[2] || "" };
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "relay"}`);
    try {
      if (url.pathname === "/v1/health" || url.pathname === "/") {
        json(res, 200, { success: true, data: { service: "autohand-relay", host: hostname(), workspaces: (await store.workspaces()).length, uptimeSeconds: Math.round(process.uptime()) } });
        return;
      }
      const target = route(url);
      if (!target) {
        json(res, 404, { success: false, error: "not found" });
        return;
      }
      if (target.error) {
        json(res, 400, { success: false, error: target.error });
        return;
      }
      const person = await authenticate(bearerFrom(req, url));
      if (!person) {
        json(res, 401, { success: false, error: "unauthorized" });
        return;
      }
      const { ws, rest } = target;

      if (rest === "/channels" && req.method === "GET") {
        json(res, 200, { success: true, data: await store.listChannels(ws) });
        return;
      }
      if (rest === "/channels" && req.method === "PUT") {
        const body = await readBody(req);
        const result = await store.putChannels(ws, body);
        for (const channel of result.changed) broadcast(ws, { type: "channel", channel, by: person.id });
        json(res, 200, { success: true, data: { channels: result.channels, changed: result.changed.length, updatedAt: result.updatedAt } });
        return;
      }
      if (rest === "/messages" && req.method === "GET") {
        json(res, 200, { success: true, data: await store.listMessages(ws, { since: url.searchParams.get("since") || "", limit: url.searchParams.get("limit") || undefined }) });
        return;
      }
      if (rest === "/presence" && req.method === "GET") {
        json(res, 200, { success: true, data: { people: presenceOf(ws) } });
        return;
      }
      const channelMatch = rest.match(/^\/channels\/([^/]+)\/messages$/);
      if (channelMatch && req.method === "GET") {
        const channelId = decodeURIComponent(channelMatch[1]);
        json(res, 200, { success: true, data: await store.listMessages(ws, { channelId, since: url.searchParams.get("since") || "", limit: url.searchParams.get("limit") || undefined }) });
        return;
      }
      if (channelMatch && req.method === "POST") {
        const channelId = decodeURIComponent(channelMatch[1]);
        const body = await readBody(req);
        const message = { ...body, origin: body.origin && typeof body.origin === "object" ? body.origin : { personId: person.id, personName: person.name } };
        if (!message.origin.personId) message.origin = { ...message.origin, personId: person.id, personName: message.origin.personName || person.name };
        const result = await store.putMessage(ws, channelId, message);
        if (result.changed) broadcast(ws, { type: "message", message: result.message, by: person.id });
        json(res, result.changed ? 201 : 200, { success: true, data: result });
        return;
      }
      json(res, 404, { success: false, error: "not found" });
    } catch (error) {
      json(res, error?.status || 500, { success: false, error: error?.message || "relay error" });
    }
  });

  server.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host || "relay"}`);
    const target = route(url);
    if (!target || target.error || target.rest !== "/stream") {
      rejectWebSocket(socket, 404, "not found");
      return;
    }
    const person = await authenticate(bearerFrom(req, url));
    if (!person) {
      rejectWebSocket(socket, 401, "unauthorized");
      return;
    }
    const connection = acceptWebSocket(req, socket, head);
    if (!connection) return;
    const { ws } = target;
    connectionSeq += 1;
    connection.meta = { id: connectionSeq, person, since: new Date().toISOString() };
    if (!rooms.has(ws)) rooms.set(ws, new Set());
    rooms.get(ws).add(connection);
    log(`+ ${person.name} joined ${ws} (${rooms.get(ws).size} connections)`);
    connection.send({ type: "hello", workspace: ws, person, people: presenceOf(ws), at: new Date().toISOString() });
    broadcast(ws, { type: "presence", people: presenceOf(ws) });
    connection.on("message", (text) => {
      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
      if (payload?.type === "ping") connection.send({ type: "pong", at: new Date().toISOString() });
    });
    connection.on("error", () => {});
    connection.on("close", () => {
      const room = rooms.get(ws);
      if (!room) return;
      room.delete(connection);
      if (!room.size) rooms.delete(ws);
      log(`- ${person.name} left ${ws}`);
      broadcast(ws, { type: "presence", people: presenceOf(ws) });
    });
  });

  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolvePromise();
    });
  });
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  const heartbeat = setInterval(() => {
    for (const room of rooms.values()) for (const connection of room) connection.ping();
  }, 30_000);
  heartbeat.unref?.();

  return {
    server,
    port: boundPort,
    host,
    url: `http://${host}:${boundPort}`,
    presence: presenceOf,
    async close() {
      clearInterval(heartbeat);
      for (const room of rooms.values()) for (const connection of room) connection.close(1001, "relay shutting down");
      await new Promise((resolvePromise) => server.close(() => resolvePromise()));
    },
  };
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") options.port = Number(argv[++i]);
    else if (arg === "--host") options.host = String(argv[++i] || "");
    else if (arg === "--data") options.dataDir = String(argv[++i] || "");
    else if (arg === "--help" || arg === "-h") options.help = true;
  }
  return options;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("node relay/server.mjs --port 8787 --data ./relay-data [--host 0.0.0.0]\n  RELAY_TOKENS=name:token,...  or  RELAY_VERIFY_ACCOUNTS=1");
    process.exit(0);
  }
  startRelay({
    port: Number.isFinite(options.port) ? options.port : Number(process.env.RELAY_PORT || 8787),
    host: options.host || process.env.RELAY_HOST || "127.0.0.1",
    dataDir: options.dataDir || process.env.RELAY_DATA || "./relay-data",
    log: (line) => console.log(`[relay] ${line}`),
  })
    .then((relay) => {
      console.log(`[relay] listening on ${relay.url} (data: ${resolve(options.dataDir || process.env.RELAY_DATA || "./relay-data")})`);
      const stop = () => relay.close().then(() => process.exit(0));
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    })
    .catch((error) => {
      console.error(`[relay] ${error.message}`);
      process.exit(1);
    });
}
