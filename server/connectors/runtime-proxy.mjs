// The process a member's engine starts for every Squad connector (ADR-0244).
//
// Engines (Autohand, Claude Code, Codex) only see `node runtime-proxy.mjs`
// with three variables: the bridge's runtime address, a per-member token and
// the connector id. The proxy asks the bridge for the real definition on
// start, so secrets and sign-in tokens never sit in a member's config file,
// and a token that expires mid-session is renewed instead of failing.
//
// - A command connector runs as a supervised child. If it dies, requests in
//   flight get a plain error, the child restarts with backoff (at most five
//   times in five minutes), and the engine's initialize handshake is replayed
//   so the session carries on.
// - An address connector is bridged from stdio to Streamable HTTP (or the
//   older SSE transport). A 401 renews the sign-in once and retries; an
//   expired MCP session is re-initialized; connection failures retry with
//   backoff and then answer in plain words.
//
// Both MCP framings are accepted from the engine and answered in kind; the
// child gets the framing its connector test detected.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createFrameReader, encodeMessage } from './framing.mjs';
import { createSseParser } from './probe.mjs';

const RESTART_DELAYS_MS = [250, 1000, 3000, 10_000, 10_000];
const RESTART_WINDOW_MS = 5 * 60_000;
const CONNECT_RETRY_MS = [500, 1500];
const CALL_TIMEOUT_MS = 300_000;
const REQUEST_TIMEOUT_MS = 30_000;
const BRIDGE_TIMEOUT_MS = 15_000;
const CONNECTION_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET']);
// Only failures before the request reached the server are retried: after a
// reset the server may already have acted, and a tool call must not run twice.
const NEVER_SENT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function connectionCode(error) {
  return error?.cause?.code || error?.code || '';
}

/** Plain words for a command that could not start (the usual cause: a missing runtime). */
export function startFailure(command, error) {
  const name = String(command || '').split(/[\\/]/).pop();
  if (error?.code === 'ENOENT') {
    const runtime = { npx: 'Node.js', node: 'Node.js', uvx: 'uv (docs.astral.sh/uv)', uv: 'uv (docs.astral.sh/uv)', docker: 'Docker Desktop', dnx: '.NET 10' }[name];
    return runtime ? `${name} isn't installed on this computer. Install ${runtime}, then test the connector again in Settings › Connectors.` : `Squad couldn't find ${name} on this computer. Check the command in Settings › Connectors.`;
  }
  if (error?.code === 'EACCES') return `${name} isn't allowed to run. Check its permissions.`;
  return `${name} couldn't start: ${String(error?.message || error).slice(0, 160)}`;
}

export async function runConnectorProxy({ input = process.stdin, output = process.stdout, env = process.env, fetchRequest = fetch, spawnProcess = spawn, exit = (code) => process.exit(code) } = {}) {
  const runtimeUrl = String(env.AUTOHAND_SQUAD_CONNECTOR_URL || '');
  const token = String(env.AUTOHAND_SQUAD_CONNECTOR_TOKEN || '');
  const id = String(env.AUTOHAND_SQUAD_CONNECTOR_ID || '');
  let endpoint;
  try { endpoint = new URL(runtimeUrl); } catch { endpoint = null; }
  const local = endpoint && endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) && !endpoint.username && !endpoint.password;

  let clientFraming = 'newline';
  const send = (message) => { try { output.write(encodeMessage(message, clientFraming)); } catch { /* the engine went away */ } };
  const replyError = (requestId, message, code = -32000) => { if (requestId !== undefined && requestId !== null) send({ jsonrpc: '2.0', id: requestId, error: { code, message } }); };

  async function bridge(path, body) {
    const target = new URL(path, endpoint);
    const response = await fetchRequest(target, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', 'x-squad-connector-token': token }, body: JSON.stringify(body), signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS) });
    const answer = await response.json().catch(() => null);
    if (!answer?.success) throw Object.assign(new Error(String(answer?.error || `Squad answered ${response.status}.`).slice(0, 300)), { status: response.status });
    return answer.data;
  }
  const report = (type, detail = '') => bridge(`${endpoint.pathname.replace(/\/+$/, '')}/report`, { id, type, detail: String(detail).slice(0, 240) }).catch(() => {});
  const launch = (stale = false) => bridge(endpoint.pathname, { id, want: 'launch', stale });

  // Messages that arrive before the connection is ready wait here.
  let handler = null;
  const early = [];
  const reader = createFrameReader((message, framing) => {
    clientFraming = framing;
    if (handler) handler(message); else early.push(message);
  });
  input.on('data', (chunk) => { try { reader.feed(chunk); } catch { /* an oversized frame: drop it */ } });

  let closing = false;
  const closers = [];
  const shutdown = async (code = 0) => {
    if (closing) return;
    closing = true;
    // Closers may return a promise (a child given time to exit); never wait past 2 s.
    const closing_ = closers.map((close) => { try { return close(); } catch { return null; } });
    await Promise.race([Promise.allSettled(closing_), sleep(2000)]);
    exit(code);
  };
  input.on('end', () => { void shutdown(0); });
  input.on('close', () => { void shutdown(0); });
  if (input === process.stdin) for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, () => { void shutdown(0); });

  /** Until the connection works, answer every request with the reason. */
  function refuse(reason) {
    handler = (message) => {
      if (message.method === 'initialize' || message.id !== undefined) replyError(message.id, reason);
    };
    early.splice(0).forEach(handler);
  }

  if (!local || !token || !id) { refuse('This connector needs Squad running on this computer. Open Squad and try again.'); return; }
  let spec;
  try { spec = await launch(false); }
  catch (error) { refuse(error.message || 'Squad could not start this connector.'); return; }
  if (spec.kind === 'stdio') superviseChild(spec);
  else bridgeHttp(spec);

  // ---------------------------------------------------------------- stdio --
  function superviseChild(definition) {
    const childEnv = { ...process.env, ...env, ...(definition.env || {}) };
    for (const key of ['AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN', 'AUTOHAND_SQUAD_CONNECTOR_URL', 'AUTOHAND_SQUAD_CONNECTOR_TOKEN', 'AUTOHAND_SQUAD_CONNECTOR_ID']) delete childEnv[key];
    // Squad's own Google servers ask the bridge for tokens themselves.
    if (definition.needsBridgeToken) Object.assign(childEnv, { AUTOHAND_SQUAD_CONNECTOR_URL: runtimeUrl, AUTOHAND_SQUAD_CONNECTOR_TOKEN: token, AUTOHAND_SQUAD_CONNECTOR_ID: id });
    const framing = definition.framing === 'header' ? 'header' : 'newline';
    let child = null;
    let ready = false;
    let initialize = null; // the engine's initialize, replayed after a restart
    let initialized = false;
    const inflight = new Set();
    const queued = [];
    const restarts = [];
    let dead = '';
    let replayId = 0;
    let stderrTail = '';

    const write = (message) => { try { child?.stdin.write(encodeMessage(message, framing)); } catch { /* exit handler deals with it */ } };

    function start() {
      stderrTail = '';
      let current;
      try { current = spawnProcess(definition.command, definition.args || [], { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); }
      catch (error) { died(startFailure(definition.command, error), true); return; }
      child = current;
      let failedToStart = false;
      current.on('error', (error) => { failedToStart = true; if (child === current) died(startFailure(definition.command, error), true); });
      current.stdin.on('error', () => {});
      current.stderr.on('data', (chunk) => { stderrTail = (stderrTail + chunk.toString()).replace(/\s+/g, ' ').slice(-300); });
      const childReader = createFrameReader((message) => {
        if (typeof message.id === 'string' && message.id.startsWith('squad-replay-')) {
          if (message.id === `squad-replay-${replayId}`) {
            write({ jsonrpc: '2.0', method: 'notifications/initialized' });
            ready = true;
            report('recovered');
            queued.splice(0).forEach(forward);
          }
          return;
        }
        if (message.id !== undefined && message.method === undefined) inflight.delete(message.id);
        send(message);
      });
      current.stdout.on('data', (chunk) => { try { childReader.feed(chunk); } catch { /* oversized frame from the server */ } });
      current.on('exit', (code, signal) => {
        if (child !== current || closing || failedToStart) return;
        died(`${definition.name || 'The connector'} stopped unexpectedly (${signal || `exit code ${code}`}).${stderrTail.trim() ? ` ${stderrTail.slice(-160).trim()}` : ''}`, false);
      });
      report('started');
      if (initialize) {
        // A restart: replay the engine's handshake before letting calls through.
        ready = false;
        replayId += 1;
        write({ jsonrpc: '2.0', id: `squad-replay-${replayId}`, method: 'initialize', params: initialize });
      } else ready = true;
    }

    function died(reason, cannotStart) {
      child = null;
      ready = false;
      report(cannotStart ? 'error' : 'crash', reason);
      const message = cannotStart ? reason : `${reason} Squad is restarting it; try the call again.`;
      for (const requestId of inflight) replyError(requestId, message);
      inflight.clear();
      const at = Date.now();
      while (restarts.length && at - restarts[0] > RESTART_WINDOW_MS) restarts.shift();
      if (cannotStart || restarts.length >= RESTART_DELAYS_MS.length) {
        dead = cannotStart ? reason : `${definition.name || 'This connector'} keeps stopping. Open Settings › Connectors to test it.`;
        for (const queuedMessage of queued.splice(0)) replyError(queuedMessage.id, dead);
        return;
      }
      const delay = RESTART_DELAYS_MS[restarts.length];
      restarts.push(at);
      setTimeout(() => { if (!closing) start(); }, delay);
    }

    function forward(message) {
      if (message.method === 'initialize') { initialize = message.params || {}; }
      if (message.method === 'notifications/initialized') initialized = true;
      if (message.id !== undefined && message.method !== undefined) inflight.add(message.id);
      write(message);
    }

    handler = (message) => {
      if (dead) { replyError(message.id, dead); return; }
      if (!child || !ready) {
        // During a restart the engine's own initialized notification is already replayed.
        if (message.method === 'notifications/initialized' && initialized) return;
        queued.push(message);
        return;
      }
      forward(message);
    };
    closers.push(() => {
      const current = child;
      child = null;
      if (!current || current.exitCode !== null || current.signalCode !== null) return null;
      // SIGTERM, then SIGKILL after 1.5 s: a server that ignores the first is not left behind.
      return new Promise((resolveExit) => {
        const killer = setTimeout(() => { try { current.kill('SIGKILL'); } catch { /* gone */ } }, 1500);
        current.once('exit', () => { clearTimeout(killer); resolveExit(); });
        try { current.kill('SIGTERM'); } catch { clearTimeout(killer); resolveExit(); }
      });
    });
    start();
    early.splice(0).forEach(handler);
  }

  // ----------------------------------------------------------------- http --
  function bridgeHttp(definition) {
    let current = definition;
    let sessionId = '';
    let initialize = null;
    let initializing = null;
    const host = (() => { try { return new URL(current.url).host; } catch { return 'the server'; } })();
    const name = current.name || host;

    async function renew() {
      current = await launch(true);
      return current;
    }

    async function post(message, { timeoutMs }) {
      let attempt = 0;
      for (;;) {
        try {
          return await fetchRequest(current.url, {
            method: 'POST',
            redirect: 'error',
            headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(current.headers || {}), ...(sessionId ? { 'mcp-session-id': sessionId } : {}) },
            body: JSON.stringify(message),
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (error) {
          if (!NEVER_SENT_CODES.has(connectionCode(error)) || attempt >= CONNECT_RETRY_MS.length) throw error;
          await sleep(CONNECT_RETRY_MS[attempt++]);
        }
      }
    }

    /** Forward every JSON-RPC message in a response body; resolve when `id`'s answer has been seen. */
    async function relay(response, requestId) {
      const type = String(response.headers.get('content-type') || '');
      if (type.includes('text/event-stream')) {
        const streamReader = response.body.getReader();
        let answered = false;
        const parser = createSseParser(({ data }) => {
          let parsed;
          try { parsed = JSON.parse(data); } catch { return; }
          for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
            if (!record(item)) continue;
            send(item);
            if (item.id === requestId && item.method === undefined) answered = true;
          }
        });
        try {
          while (!answered) {
            const { value, done } = await streamReader.read();
            if (done) break;
            parser.feed(value);
          }
        } finally { streamReader.cancel().catch(() => {}); }
        return answered;
      }
      const raw = await response.text();
      if (!raw.trim()) return false;
      let parsed;
      try { parsed = JSON.parse(raw); } catch { throw new Error(`${name} answered with something other than MCP: ${raw.slice(0, 120)}`); }
      let answered = false;
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
        if (!record(item)) continue;
        send(item);
        if (item.id === requestId) answered = true;
      }
      return answered;
    }

    async function reinitialize() {
      sessionId = '';
      if (!initialize) return;
      const response = await post({ jsonrpc: '2.0', id: 'squad-reinit', method: 'initialize', params: initialize }, { timeoutMs: REQUEST_TIMEOUT_MS });
      const found = response.headers.get('mcp-session-id');
      if (found) sessionId = found;
      await response.body?.cancel().catch(() => {});
      if (!response.ok) throw new Error(`${name} refused to start a new session (HTTP ${response.status}).`);
      const ack = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { timeoutMs: REQUEST_TIMEOUT_MS });
      await ack.body?.cancel().catch(() => {});
    }

    async function deliver(message) {
      const isRequest = message.id !== undefined && message.method !== undefined;
      if (message.method === 'initialize') initialize = message.params || {};
      const timeoutMs = message.method === 'tools/call' ? CALL_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
      let renewed = false, restarted = false;
      for (;;) {
        let response;
        try { response = await post(message, { timeoutMs }); }
        catch (error) {
          const code = connectionCode(error);
          const reason = ['TimeoutError', 'AbortError'].includes(error?.name) ? `${name} didn't answer within ${Math.round(timeoutMs / 1000)} seconds.`
            : code === 'ENOTFOUND' || code === 'EAI_AGAIN' ? `Can't find ${host}. Check this computer's internet connection.`
              : CONNECTION_CODES.has(code) ? `Can't reach ${host}. Check this computer's internet connection, then try again.`
                : `${name} couldn't be reached: ${String(error?.message || error).slice(0, 160)}`;
          report('error', reason);
          if (isRequest) replyError(message.id, reason);
          return;
        }
        const found = response.headers.get('mcp-session-id');
        if (found) sessionId = found;
        if (response.status === 401 && !renewed && current.oauth) {
          await response.body?.cancel().catch(() => {});
          renewed = true;
          try { await renew(); continue; }
          catch (error) { report('error', error.message); if (isRequest) replyError(message.id, error.message); return; }
        }
        if (response.status === 404 && sessionId && message.method !== 'initialize' && !restarted) {
          // The server forgot our session (restart, idle timeout): start a new one and resend.
          await response.body?.cancel().catch(() => {});
          restarted = true;
          try { await reinitialize(); continue; }
          catch (error) { report('error', error.message); if (isRequest) replyError(message.id, error.message); return; }
        }
        if (response.status === 202 || (!isRequest && response.ok)) { await response.body?.cancel().catch(() => {}); return; }
        if (!response.ok) {
          const body = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
          const reason = response.status === 401 || response.status === 403
            ? current.oauth ? `${name} needs you to sign in again. Open Settings › Connectors.` : `${name} refused the stored key (HTTP ${response.status}). Update it in Settings › Connectors.`
            : response.status === 429 ? `${name} is limiting requests right now. Try again shortly.`
              : `${name} answered HTTP ${response.status}${body ? `: ${body}` : ''}`;
          report('error', reason);
          if (isRequest) replyError(message.id, reason);
          return;
        }
        try {
          const answered = await relay(response, message.id);
          if (isRequest && !answered) replyError(message.id, `${name} closed the response without answering.`);
        } catch (error) {
          report('error', error.message);
          if (isRequest) replyError(message.id, String(error.message || error).slice(0, 240));
        }
        if (message.method === 'initialize') report('started');
        return;
      }
    }

    handler = (message) => {
      // Everything waits for initialize to finish so the session id exists.
      if (message.method === 'initialize') { initializing = deliver(message); return; }
      const run = () => deliver(message);
      (initializing ? initializing.then(run, run) : run()).catch((error) => replyError(message.id, String(error?.message || error)));
    };
    closers.push(() => {
      if (sessionId) fetchRequest(current.url, { method: 'DELETE', headers: { ...(current.headers || {}), 'mcp-session-id': sessionId }, signal: AbortSignal.timeout(2000) }).catch(() => {});
    });
    if (current.transport === 'sse') { bridgeLegacySse(); return; }
    early.splice(0).forEach(handler);
  }

  /** The older transport: a GET event stream that names a POST endpoint. */
  function bridgeLegacySse() {
    let current = spec;
    const name = current.name || 'The server';
    let messagesUrl = '';
    let controller = null;
    let initialize = null;
    let opened = null;
    let reconnects = 0;
    let refusedEndpoint = '';
    const waiting = [];

    async function open(stale = false) {
      if (stale) current = await launch(true);
      controller?.abort();
      controller = new AbortController();
      const response = await fetchRequest(current.url, { method: 'GET', redirect: 'error', headers: { accept: 'text/event-stream', ...(current.headers || {}) }, signal: controller.signal });
      if (response.status === 401 && !stale && current.oauth) return open(true);
      if (!response.ok) throw new Error(`${name} answered HTTP ${response.status}.`);
      let announce;
      const announced = new Promise((resolveAnnounce) => { announce = resolveAnnounce; });
      const parser = createSseParser(({ event, data }) => {
        if (event === 'endpoint') {
          // The stream names where to post; credentials go there, so only on the server's own origin.
          let named = null;
          try { named = new URL(data, current.url); } catch { named = null; }
          if (named && named.origin === new URL(current.url).origin) messagesUrl = named.toString();
          else refusedEndpoint = `${name} named a message address on another server; Squad refused to send it your credentials.`;
          announce();
          return;
        }
        try { const parsed = JSON.parse(data); if (record(parsed) && !(typeof parsed.id === 'string' && parsed.id.startsWith('squad-'))) send(parsed); } catch { /* chatter */ }
      });
      const streamReader = response.body.getReader();
      void (async () => {
        try { for (;;) { const { value, done } = await streamReader.read(); if (done) break; parser.feed(value); } } catch { /* aborted */ }
        if (closing || controller?.signal.aborted) return;
        // The stream dropped: reconnect with backoff and replay the handshake.
        messagesUrl = '';
        reconnects += 1;
        report('error', `${name} closed its event stream; reconnecting.`);
        await sleep(Math.min(10_000, 500 * 2 ** Math.min(reconnects, 5)));
        opened = open(false).then(replay).catch((error) => { report('error', error.message); });
      })();
      await Promise.race([announced, sleep(REQUEST_TIMEOUT_MS)]);
      if (!messagesUrl) throw new Error(refusedEndpoint || `${name} never announced where to send messages.`);
      reconnects = 0;
    }
    async function replay() {
      if (!initialize) return;
      await postMessage({ jsonrpc: '2.0', id: 'squad-reinit', method: 'initialize', params: initialize });
      await postMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
    }
    async function postMessage(message) {
      const response = await fetchRequest(messagesUrl, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', ...(current.headers || {}) }, body: JSON.stringify(message), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      await response.body?.cancel().catch(() => {});
      if (!response.ok) throw new Error(`${name} answered HTTP ${response.status}.`);
    }
    handler = (message) => {
      if (message.method === 'initialize') initialize = message.params || {};
      const run = async () => {
        try { await opened; await postMessage(message); }
        catch (error) { report('error', error.message); if (message.id !== undefined && message.method !== undefined) replyError(message.id, String(error.message).slice(0, 240)); }
      };
      waiting.push(run());
    };
    closers.push(() => controller?.abort());
    opened = open(false).catch((error) => { report('error', error.message); throw error; });
    early.splice(0).forEach(handler);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  delete process.env.AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN;
  runConnectorProxy().catch((error) => { process.stderr.write(`${String(error?.message || error).slice(0, 300)}\n`); process.exit(1); });
}
