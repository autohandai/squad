#!/usr/bin/env node
// Checks for remote members (server/remote/*, server/routes/remote.route.mjs).
//
// Starts a tiny fake "remote bridge" on 127.0.0.1 that validates the bearer
// token and serves /api/runtime, /api/chat, /api/members/presence and an SSE
// /api/chat/stream. Then verifies that the proxy sends the token and the
// transport header, that the stream passes through unchanged, that failures
// name the remote, that the registry file is written 0600 and never leaks
// tokens in public shapes, and that the route plug-in probes before saving.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bearerTokenAllowed, bearerTokenFromRequest, hashToken, isRemoteTransport, mintToken } from "../server/remote/auth.mjs";
import { RemoteError, probe, probeSentence, proxyJson, proxyStream } from "../server/remote/proxy.mjs";
import { createRemoteRegistry, publicRemote } from "../server/remote/registry.mjs";
import { handle, init, remoteRequestAuth, resolveRemote } from "../server/routes/remote.route.mjs";

const SHARED_TOKEN = mintToken();
const seen = [];
const sseChunks = ["event: start\ndata: {\"startedAt\":\"2026-09-26T00:00:00.000Z\",\"workspace\":\"/srv/work\"}\n\n", "event: token\ndata: {\"text\":\"Hello from the other machine\"}\n\n", "event: done\ndata: {\"reply\":\"Hello from the other machine\",\"status\":\"completed\"}\n\n"];

function readJson(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body ? JSON.parse(body) : {}));
  });
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

// ---- fake remote bridge -----------------------------------------------------
const remoteBridge = createServer(async (req, res) => {
  seen.push({ path: req.url, method: req.method, headers: req.headers });
  if (!bearerTokenAllowed(req, [{ hash: hashToken(SHARED_TOKEN) }])) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "bearer token required" }));
    return;
  }
  if (req.url === "/api/runtime" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ success: true, data: { squadVersion: "1.4.0", version: "0.9.2", available: true, harnesses: { ids: ["autohand", "claude"] }, account: { email: "kai@example.test" }, sessions: { active: 1, busy: 0 }, serverStartedAt: "2026-09-26T00:00:00.000Z" } }));
    return;
  }
  if (req.url === "/api/members/presence" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ success: true, data: { members: [{ memberId: "kai", state: "idle" }] } }));
    return;
  }
  if (req.url === "/api/chat" && req.method === "POST") {
    const payload = await readJson(req);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ success: true, data: { reply: `echo: ${payload.prompt}`, agentId: payload.agentId } }));
    return;
  }
  if (req.url === "/api/chat/stream" && req.method === "POST") {
    await readJson(req);
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" });
    res.write(": connected\n\n");
    let index = 0;
    const timer = setInterval(() => {
      if (index >= sseChunks.length) {
        clearInterval(timer);
        res.end();
        return;
      }
      res.write(sseChunks[index++]);
    }, 15);
    return;
  }
  if (req.url === "/api/runs" && req.method === "POST") {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "workspace must live under the home folder" }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ success: false, error: `no route for ${req.method} ${req.url}` }));
});

// ---- a "local bridge" whose one route proxies the stream ---------------------
let remote;
const localBridge = createServer(async (req, res) => {
  if (req.url === "/api/chat/stream" && req.method === "POST") {
    const payload = await readJson(req);
    try {
      await proxyStream(remote, "/api/chat/stream", payload, res);
    } catch (error) {
      res.writeHead(error.status || 502, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: false, error: error.message }));
    }
    return;
  }
  res.writeHead(404);
  res.end();
});

const stateDir = await mkdtemp(join(tmpdir(), "squad-remote-"));
try {
  const remotePort = await listen(remoteBridge);
  const localPort = await listen(localBridge);
  remote = { url: `http://127.0.0.1:${remotePort}`, token: SHARED_TOKEN, label: "Kai's Mac mini" };

  // ---- auth helpers ---------------------------------------------------------
  const minted = mintToken();
  assert.match(minted, /^ahs_[A-Za-z0-9_-]{43}$/, "minted token shape");
  assert.notEqual(minted, mintToken(), "tokens are random");
  assert.equal(bearerTokenFromRequest({ headers: { authorization: `Bearer ${minted}` } }), minted);
  assert.equal(bearerTokenFromRequest({ headers: {} }), "");
  assert.ok(bearerTokenAllowed({ headers: { authorization: `Bearer ${minted}` } }, [minted]), "raw token list");
  assert.ok(bearerTokenAllowed({ headers: { authorization: `bearer ${minted}` } }, [{ hash: hashToken(minted) }]), "hash list, case-insensitive scheme");
  assert.ok(!bearerTokenAllowed({ headers: { authorization: `Bearer ${minted}x` } }, [minted]), "wrong token rejected");
  assert.ok(!bearerTokenAllowed({ headers: {} }, [minted]), "missing token rejected");
  assert.ok(isRemoteTransport({ headers: { "x-autohand-transport": "remote" } }));
  assert.ok(!isRemoteTransport({ headers: {} }));

  // ---- registry -------------------------------------------------------------
  const registry = createRemoteRegistry({ squadStateDir: stateDir, now: () => "2026-09-26T10:00:00.000Z" });
  const savedShape = await registry.set("kai", { url: `${remote.url}/`, token: SHARED_TOKEN, label: remote.label });
  assert.deepEqual(savedShape, { memberId: "kai", url: remote.url, label: remote.label, addedAt: "2026-09-26T10:00:00.000Z", hasToken: true }, "set returns public shape without token");
  const mode = (await stat(registry.path)).mode & 0o777;
  assert.equal(mode, 0o600, `remotes.json mode is ${mode.toString(8)}, expected 600`);
  const raw = JSON.parse(await readFile(registry.path, "utf8"));
  assert.equal(raw.kai.token, SHARED_TOKEN, "token persisted for the proxy");
  const full = await registry.get("kai");
  assert.equal(full.token, SHARED_TOKEN);
  assert.equal(full.memberId, "kai");
  const listed = await registry.list();
  assert.equal(listed.length, 1);
  assert.ok(!("token" in listed[0]), "list() never returns tokens");
  assert.ok(JSON.stringify(publicRemote("kai", full)).includes(SHARED_TOKEN) === false, "publicRemote hides the token");
  const withTokens = await registry.list({ includeTokens: true });
  assert.equal(withTokens[0].token, SHARED_TOKEN);
  await assert.rejects(() => registry.set("_served", { url: remote.url, token: "x" }), /member id is not valid/, "reserved key rejected");
  await assert.rejects(() => registry.set("kai", { url: "ftp://nope", token: "x" }), /http:\/\/ or https:\/\//);
  await assert.rejects(() => registry.set("new", { url: remote.url }), /token is required/);
  await registry.set("kai", { url: remote.url, label: "Renamed" }); // keeps the token
  assert.equal((await registry.get("kai")).token, SHARED_TOKEN, "re-set without token keeps the stored token");
  assert.equal((await registry.get("kai")).addedAt, "2026-09-26T10:00:00.000Z", "addedAt survives re-set");
  const served = await registry.addServedToken({ token: minted, label: "Laptop" });
  assert.deepEqual(Object.keys(served).sort(), ["createdAt", "id", "label"]);
  const servedRaw = JSON.parse(await readFile(registry.path, "utf8"))._served;
  assert.equal(servedRaw.length, 1);
  assert.equal(servedRaw[0].hash, hashToken(minted), "served tokens are stored hashed");
  assert.ok(!JSON.stringify(servedRaw).includes(minted), "served clear token is never written");
  assert.ok(bearerTokenAllowed({ headers: { authorization: `Bearer ${minted}` } }, await registry.servedTokens()), "served hashes validate a bearer");
  assert.equal((await stat(registry.path)).mode & 0o777, 0o600, "mode stays 0600 after rewrite");
  assert.equal(await registry.remove("nobody"), false);

  // ---- proxyJson ------------------------------------------------------------
  seen.length = 0;
  const reply = await proxyJson(remote, "/api/chat", { agentId: "kai", prompt: "hi" });
  assert.equal(reply.reply, "echo: hi");
  assert.equal(reply.transport, "remote", "replies carry transport: remote");
  assert.equal(reply.remote.label, remote.label);
  assert.equal(seen[0].headers.authorization, `Bearer ${SHARED_TOKEN}`, "bearer token forwarded");
  assert.equal(seen[0].headers["x-autohand-transport"], "remote", "transport header forwarded");
  assert.equal(seen[0].method, "POST");
  assert.equal(seen[0].path, "/api/chat");

  // ---- probe ----------------------------------------------------------------
  const summary = await probe(remote);
  assert.equal(summary.ok, true);
  assert.equal(summary.squadVersion, "1.4.0");
  assert.equal(summary.cliVersion, "0.9.2");
  assert.equal(summary.account, "kai@example.test");
  assert.deepEqual(summary.harnesses, ["autohand", "claude"]);
  assert.match(probeSentence(summary), /^Reached Kai's Mac mini in \d+ ms · Squad 1\.4\.0 · autohand 0\.9\.2 · kai@example\.test\.$/);

  // ---- proxyStream passes SSE through unchanged ------------------------------
  seen.length = 0;
  const streamResponse = await fetch(`http://127.0.0.1:${localPort}/api/chat/stream`, { method: "POST", body: JSON.stringify({ agentId: "kai", prompt: "stream" }) });
  assert.equal(streamResponse.status, 200);
  assert.match(streamResponse.headers.get("content-type"), /text\/event-stream/);
  assert.equal(streamResponse.headers.get("x-autohand-transport"), "remote");
  const streamed = await streamResponse.text();
  const remoteEventEnd = streamed.indexOf("\n\n") + 2;
  const remoteEvent = streamed.slice(0, remoteEventEnd);
  assert.match(remoteEvent, /^event: remote\ndata: \{"transport":"remote","label":"Kai's Mac mini"/, "stream opens with one remote event");
  assert.equal(streamed.slice(remoteEventEnd), `: connected\n\n${sseChunks.join("")}`, "upstream bytes pass through unchanged");
  assert.equal(seen[0].headers.authorization, `Bearer ${SHARED_TOKEN}`, "stream request carries the token");
  assert.equal(seen[0].headers["x-autohand-transport"], "remote");
  assert.equal(seen[0].headers.accept, "text/event-stream");

  // ---- failures name the remote ---------------------------------------------
  const badToken = { ...remote, token: "ahs_wrong" };
  await assert.rejects(() => proxyJson(badToken, "/api/chat", { prompt: "x" }), (error) => {
    assert.ok(error instanceof RemoteError);
    assert.equal(error.status, 401);
    assert.equal(error.retryable, false);
    assert.match(error.message, /^Kai's Mac mini: rejected the token/);
    return true;
  });
  await assert.rejects(() => proxyJson(remote, "/api/runs", { agentId: "kai" }), (error) => {
    assert.equal(error.status, 400);
    assert.equal(error.message, "Kai's Mac mini: workspace must live under the home folder");
    return true;
  });
  const throwaway = createServer();
  const closedPort = await listen(throwaway);
  await new Promise((resolve) => throwaway.close(resolve));
  const dead = { url: `http://127.0.0.1:${closedPort}`, token: SHARED_TOKEN, label: "Studio" };
  await assert.rejects(() => probe(dead), (error) => {
    assert.ok(error instanceof RemoteError);
    assert.equal(error.status, 502);
    assert.match(error.message, /^Studio: refused the connection/);
    return true;
  });
  const silent = createServer(() => {}); // accepts, never answers
  const silentPort = await listen(silent);
  await assert.rejects(() => proxyJson({ url: `http://127.0.0.1:${silentPort}`, token: "t", label: "Slow" }, "/api/runtime", undefined, { timeoutMs: 150 }), (error) => {
    assert.equal(error.status, 504);
    assert.equal(error.message, "Slow: did not answer within 150 ms");
    return true;
  });
  silent.closeAllConnections?.();
  silent.close();
  const unlabeled = await probe({ url: remote.url, token: SHARED_TOKEN }).then((result) => result.label);
  assert.equal(unlabeled, `127.0.0.1:${remotePort}`, "label falls back to the host");
  remote = badToken;
  const rejectedStream = await fetch(`http://127.0.0.1:${localPort}/api/chat/stream`, { method: "POST", body: JSON.stringify({ agentId: "kai" }) });
  assert.equal(rejectedStream.status, 401);
  assert.match((await rejectedStream.json()).error, /^Kai's Mac mini: rejected the token/, "stream failure before headers names the remote");
  remote = { url: `http://127.0.0.1:${remotePort}`, token: SHARED_TOKEN, label: "Kai's Mac mini" };

  // ---- route plug-in --------------------------------------------------------
  const responses = [];
  const ctx = {
    squadStateDir: join(stateDir, "route"),
    json: (res, status, payload) => responses.push({ status, payload }),
    readBody: async (req) => req.body || {},
    logEvent() {},
    SEVERITY: { INFO: 9 },
  };
  await init(ctx);
  const call = (method, pathname, body) => handle({ method, body, headers: { host: "127.0.0.1:19821" } }, {}, new URL(`http://x${pathname}`), ctx);
  const last = () => responses[responses.length - 1];

  assert.equal(await call("GET", "/api/runtime"), false, "ignores other routes");
  assert.equal(await call("GET", "/api/remote/members"), true);
  assert.deepEqual(last(), { status: 200, payload: { success: true, data: [] } });

  await call("PUT", "/api/remote/members/kai", { url: `http://127.0.0.1:${closedPort}`, token: "ahs_x", label: "Studio" });
  assert.equal(last().status, 400, "PUT probes first and refuses an unreachable remote");
  assert.match(last().payload.error, /^Studio: refused the connection/);
  assert.equal(last().payload.retryable, true);
  await call("GET", "/api/remote/members");
  assert.deepEqual(last().payload.data, [], "nothing saved after a failed probe");

  await call("PUT", "/api/remote/members/kai", { url: remote.url, token: "ahs_wrong", label: remote.label });
  assert.equal(last().status, 400);
  assert.match(last().payload.error, /rejected the token/);

  await call("PUT", "/api/remote/members/kai", { url: remote.url, token: SHARED_TOKEN, label: remote.label });
  assert.equal(last().status, 200, `PUT saved: ${JSON.stringify(last().payload)}`);
  assert.equal(last().payload.data.hasToken, true);
  assert.ok(!("token" in last().payload.data), "PUT response hides the token");
  assert.equal(last().payload.data.probe.squadVersion, "1.4.0");

  await call("GET", "/api/remote/members");
  assert.equal(last().payload.data.length, 1);
  assert.ok(!JSON.stringify(last().payload).includes(SHARED_TOKEN), "GET members never leaks tokens");

  const resolved = await resolveRemote(ctx, "kai");
  assert.equal(resolved.token, SHARED_TOKEN, "resolveRemote hands the proxy the token");
  assert.equal(await resolveRemote(ctx, "someone-else"), null);
  assert.equal(await resolveRemote(ctx, "kai", { req: { headers: { "x-autohand-transport": "remote" } } }), null, "a proxied request is never proxied again");

  await call("POST", "/api/remote/members/kai/probe", {});
  assert.equal(last().status, 200);
  assert.equal(last().payload.data.label, remote.label);
  await call("POST", "/api/remote/members/kai/probe", { url: `http://127.0.0.1:${closedPort}`, label: "Candidate" });
  assert.equal(last().status, 502);
  assert.match(last().payload.error, /^Candidate: refused the connection/);

  await call("GET", "/api/remote/members/kai/presence");
  assert.equal(last().status, 200);
  assert.equal(last().payload.data.available, true);
  assert.deepEqual(last().payload.data.members, [{ memberId: "kai", state: "idle" }]);
  assert.equal(last().payload.data.transport, "remote");

  await call("POST", "/api/remote/tokens", { label: "Igor's laptop" });
  assert.equal(last().status, 201);
  const mintedByRoute = last().payload.data;
  assert.match(mintedByRoute.token, /^ahs_/);
  assert.equal(mintedByRoute.label, "Igor's laptop");
  assert.equal(mintedByRoute.url, "http://127.0.0.1:19821");
  const auth = await remoteRequestAuth(ctx, { headers: { authorization: `Bearer ${mintedByRoute.token}` } });
  assert.deepEqual(auth, { remote: true, allowed: true, token: { id: mintedByRoute.id, label: "Igor's laptop" } });
  assert.deepEqual(await remoteRequestAuth(ctx, { headers: { authorization: "Bearer ahs_nope" } }), { remote: true, allowed: false, token: null });
  assert.deepEqual(await remoteRequestAuth(ctx, { headers: {} }), { remote: false, allowed: false, token: null });
  await call("GET", "/api/remote/tokens");
  assert.ok(!JSON.stringify(last().payload).includes(mintedByRoute.token), "token list never shows clear tokens");
  await call("DELETE", `/api/remote/tokens/${mintedByRoute.id}`);
  assert.equal(last().payload.data.removed, true);
  assert.equal((await remoteRequestAuth(ctx, { headers: { authorization: `Bearer ${mintedByRoute.token}` } })).allowed, false, "revoked token no longer allowed");

  await call("DELETE", "/api/remote/members/kai");
  assert.deepEqual(last().payload.data, { memberId: "kai", removed: true });
  assert.equal(await resolveRemote(ctx, "kai"), null);
  assert.equal((await stat(join(ctx.squadStateDir, "remotes.json"))).mode & 0o777, 0o600, "route registry file is 0600");

  console.log("check:remote ok — proxy forwards token + transport header, SSE passes through, failures name the remote, remotes.json is 0600");
} finally {
  remoteBridge.close();
  localBridge.close();
  await rm(stateDir, { recursive: true, force: true });
}
