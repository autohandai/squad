// Test a connector: start the command or connect to the URL, complete the MCP
// initialize handshake, list its tools, and come back with tool names or one
// bounded error. Nothing here is kept running; a probe always ends its child
// or stream before returning.
import { spawn } from 'node:child_process';
import { LATEST_PROTOCOL, boundedError, createFrameReader, encodeMessage } from './framing.mjs';

const CLIENT_INFO = { name: 'autohand-squad', version: '1' };
const MAX_TOOLS = 200;
const MAX_STREAM = 4 * 1024 * 1024;
const STDERR_TAIL = 600;

function initializeParams() {
  return { protocolVersion: LATEST_PROTOCOL, capabilities: {}, clientInfo: CLIENT_INFO };
}

function publicTools(result) {
  return (Array.isArray(result?.tools) ? result.tools : [])
    .filter((tool) => tool && typeof tool.name === 'string')
    .slice(0, MAX_TOOLS)
    .map((tool) => ({ name: tool.name, description: String(tool.description || '').replace(/\s+/g, ' ').trim().slice(0, 200) }));
}

function rpcFailure(response, fallback) {
  if (response?.error) return new Error(response.error.message || fallback);
  return null;
}

/**
 * Probe a stdio server. Sends initialize in newline framing first; if the
 * server has not answered after a short grace period it is sent again with
 * Content-Length headers, and whichever framing the server answers in is the
 * one reported back (and the one the member's config will use).
 */
export async function probeStdio({ command, args = [], env = {}, cwd, timeoutMs = 15000, spawnProcess = spawn }) {
  const started = Date.now();
  const remaining = () => Math.max(0, timeoutMs - (Date.now() - started));
  const pending = new Map();
  let stderr = '';
  let exited = null;
  let child;
  try {
    const childEnv = { ...process.env, ...env };
    delete childEnv.AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN;
    child = spawnProcess(command, args, { cwd: cwd || undefined, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  } catch (failure) {
    return ({ ok: false, error: boundedError(`Could not start ${command}: ${failure.message}`) });
  }
  const spawnFailure = new Promise((resolveFailure) => {
    child.on('error', (failure) => resolveFailure(new Error(`Could not start ${command}: ${failure.message}`)));
    child.on('exit', (code, signal) => {
      exited = { code, signal };
      resolveFailure(new Error(`${command} exited (${signal || `code ${code}`}) before finishing the MCP handshake.${stderr ? ` ${stderr}` : ''}`));
    });
  });
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).replace(/\s+/g, ' ').slice(-STDERR_TAIL); });
  const reader = createFrameReader((message, framing) => {
    if (message.id === undefined || message.id === null) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    waiter.resolve({ response: message, framing });
  });
  let readerFailure = null;
  child.stdout.on('data', (chunk) => { try { reader.feed(chunk); } catch (failure) { readerFailure = failure; } });

  // A write that fails (EPIPE on a command that never started) is not the
  // story: the spawn error or exit that follows is, and the races below
  // surface it. So a failed write resolves and lets those speak.
  child.stdin.on('error', () => {});
  function send(message, framing) {
    return new Promise((resolveWrite) => {
      if (exited) { resolveWrite(); return; }
      child.stdin.write(encodeMessage(message, framing), () => resolveWrite());
    });
  }
  function waitFor(ids, waitMs) {
    return new Promise((resolveWait) => {
      const timer = setTimeout(() => { for (const id of ids) pending.delete(id); resolveWait(null); }, waitMs);
      for (const id of ids) pending.set(id, { resolve: (value) => { clearTimeout(timer); for (const other of ids) pending.delete(other); resolveWait(value); } });
    });
  }
  async function request(id, method, params, framing) {
    await send({ jsonrpc: '2.0', id, method, params }, framing);
    const outcome = await Promise.race([waitFor([id], remaining()), spawnFailure]);
    if (outcome instanceof Error) throw outcome;
    if (!outcome) throw new Error(`No MCP ${method} response within ${Math.round(timeoutMs / 1000)}s.${stderr ? ` ${stderr}` : ''}`);
    const failure = rpcFailure(outcome.response, `${method} failed.`);
    if (failure) throw failure;
    return outcome;
  }

  try {
    // Newline first (the spec), then Content-Length after a grace period.
    const grace = Math.min(2500, remaining());
    await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: initializeParams() }, 'newline');
    let outcome = await Promise.race([waitFor([1], grace), spawnFailure]);
    if (outcome instanceof Error) throw outcome;
    if (!outcome) {
      await send({ jsonrpc: '2.0', id: 2, method: 'initialize', params: initializeParams() }, 'header');
      outcome = await Promise.race([waitFor([1, 2], remaining()), spawnFailure]);
      if (outcome instanceof Error) throw outcome;
      if (!outcome) throw new Error(`No MCP initialize response within ${Math.round(timeoutMs / 1000)}s.${stderr ? ` ${stderr}` : ''}`);
    }
    if (readerFailure) throw readerFailure;
    const initFailure = rpcFailure(outcome.response, 'initialize failed.');
    if (initFailure) throw initFailure;
    const framing = outcome.framing;
    const initialized = outcome.response.result || {};
    await send({ jsonrpc: '2.0', method: 'notifications/initialized' }, framing);
    const listed = await request(3, 'tools/list', {}, framing);
    return ({ ok: true, framing, protocolVersion: String(initialized.protocolVersion || ''), serverInfo: publicServerInfo(initialized.serverInfo), tools: publicTools(listed.response.result) });
  } catch (failure) {
    return ({ ok: false, error: boundedError(failure) });
  } finally {
    for (const waiter of pending.values()) waiter.resolve(null);
    pending.clear();
    if (!exited) {
      child.kill('SIGTERM');
      const closed = new Promise((resolveClose) => child.once('exit', resolveClose));
      const killer = setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, 1500);
      await Promise.race([closed, new Promise((resolveWait) => setTimeout(resolveWait, 2000))]);
      clearTimeout(killer);
    }
  }
}

function publicServerInfo(info) {
  return info && typeof info === 'object' ? { name: String(info.name || '').slice(0, 120), version: String(info.version || '').slice(0, 60) } : null;
}

/** Parse Server-Sent Events incrementally; `onEvent({ event, data })` per block. */
export function createSseParser(onEvent) {
  let buffer = '';
  let total = 0;
  return {
    feed(chunk) {
      const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      total += text.length;
      if (total > MAX_STREAM) throw new Error('The event stream exceeded its size limit.');
      buffer += text.replace(/\r\n/g, '\n');
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        let event = 'message';
        const data = [];
        for (const line of block.split('\n')) {
          if (line.startsWith(':')) continue;
          const colon = line.indexOf(':');
          const field = colon < 0 ? line : line.slice(0, colon);
          const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
          if (field === 'event') event = value;
          else if (field === 'data') data.push(value);
        }
        if (data.length) onEvent({ event, data: data.join('\n') });
      }
    },
  };
}

function validatedUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || '')); } catch { throw new Error('Enter a valid http or https address.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Connector addresses must start with http:// or https://.');
  return parsed;
}

async function responseFailure(response) {
  const text = await response.text().catch(() => '');
  return new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ''}`);
}

/** Read an SSE response body until `until(message)` is satisfied or it ends. */
async function readSseUntil(response, until, signal) {
  const reader = response.body.getReader();
  let found = null;
  const parser = createSseParser(({ data }) => {
    if (found) return;
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (until(message)) found = message;
  });
  try {
    while (!found) {
      if (signal?.aborted) throw new Error('The request timed out.');
      const { value, done } = await reader.read();
      if (done) break;
      parser.feed(value);
    }
  } finally { reader.cancel().catch(() => {}); }
  return found;
}

/**
 * Probe a URL server. `transport` is "http" (Streamable HTTP, the current
 * spec) or "sse" (the older GET stream plus POST endpoint).
 */
export async function probeHttp({ url, transport = 'http', headers = {}, timeoutMs = 15000, fetchRequest = fetch }) {
  try {
    const endpoint = validatedUrl(url);
    const started = Date.now();
    const remaining = () => Math.max(1, timeoutMs - (Date.now() - started));
    const baseHeaders = { ...headers };
    if (transport === 'sse') return await probeLegacySse({ endpoint, headers: baseHeaders, remaining, fetchRequest });
    let sessionId = '';
    async function post(message, expectResponse) {
      const response = await fetchRequest(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...baseHeaders, ...(sessionId ? { 'mcp-session-id': sessionId } : {}) },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(remaining()),
      });
      const found = response.headers.get('mcp-session-id');
      if (found) sessionId = found;
      if (!response.ok) throw await responseFailure(response);
      if (!expectResponse) { await response.body?.cancel().catch(() => {}); return null; }
      const type = String(response.headers.get('content-type') || '');
      let reply;
      if (type.includes('text/event-stream')) reply = await readSseUntil(response, (candidate) => candidate?.id === message.id, AbortSignal.timeout(remaining()));
      else { const text = await response.text(); try { reply = JSON.parse(text); } catch { throw new Error(`The server answered with something other than JSON-RPC: ${text.slice(0, 120)}`); } }
      if (!reply) throw new Error(`No ${message.method} response arrived on the event stream.`);
      const failure = rpcFailure(reply, `${message.method} failed.`);
      if (failure) throw failure;
      return reply.result || {};
    }
    const initialized = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: initializeParams() }, true);
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, false).catch(() => {});
    const listed = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, true);
    if (sessionId) await fetchRequest(endpoint, { method: 'DELETE', headers: { ...baseHeaders, 'mcp-session-id': sessionId }, signal: AbortSignal.timeout(3000) }).then((response) => response.body?.cancel().catch(() => {})).catch(() => {});
    return { ok: true, transport: 'http', protocolVersion: String(initialized.protocolVersion || ''), serverInfo: publicServerInfo(initialized.serverInfo), tools: publicTools(listed) };
  } catch (failure) {
    return { ok: false, error: boundedError(['TimeoutError', 'AbortError'].includes(failure.name) ? `The server did not answer within ${Math.round(timeoutMs / 1000)}s.` : failure) };
  }
}

async function probeLegacySse({ endpoint, headers, remaining, fetchRequest }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining());
  const pending = new Map();
  let messagesUrl = '';
  let endpointReady;
  const endpointPromise = new Promise((resolveEndpoint) => { endpointReady = resolveEndpoint; });
  let streamFailure = null;
  try {
    const response = await fetchRequest(endpoint, { method: 'GET', headers: { accept: 'text/event-stream', ...headers }, signal: controller.signal });
    if (!response.ok) throw await responseFailure(response);
    if (!String(response.headers.get('content-type') || '').includes('text/event-stream')) throw new Error('The address did not open an event stream. Try the Streamable HTTP transport.');
    const reader = response.body.getReader();
    const parser = createSseParser(({ event, data }) => {
      if (event === 'endpoint') { messagesUrl = new URL(data, endpoint).toString(); endpointReady(); return; }
      let message;
      try { message = JSON.parse(data); } catch { return; }
      const waiter = pending.get(message?.id);
      if (waiter) { pending.delete(message.id); waiter(message); }
    });
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          parser.feed(value);
        }
        streamFailure = new Error('The event stream closed before the handshake finished.');
      } catch (failure) { streamFailure = failure; }
      endpointReady();
      for (const waiter of pending.values()) waiter(null);
      pending.clear();
    })();
    await endpointPromise;
    if (!messagesUrl) throw streamFailure || new Error('The server never announced its message endpoint.');
    async function request(id, method, params) {
      const reply = new Promise((resolveReply) => pending.set(id, resolveReply));
      const posted = await fetchRequest(messagesUrl, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: controller.signal });
      if (!posted.ok) throw await responseFailure(posted);
      await posted.body?.cancel().catch(() => {});
      const message = await reply;
      if (!message) throw streamFailure || new Error(`No ${method} response arrived on the event stream.`);
      const failure = rpcFailure(message, `${method} failed.`);
      if (failure) throw failure;
      return message.result || {};
    }
    const initialized = await request(1, 'initialize', initializeParams());
    await fetchRequest(messagesUrl, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), signal: controller.signal }).then((posted) => posted.body?.cancel().catch(() => {})).catch(() => {});
    const listed = await request(2, 'tools/list', {});
    return { ok: true, transport: 'sse', protocolVersion: String(initialized.protocolVersion || ''), serverInfo: publicServerInfo(initialized.serverInfo), tools: publicTools(listed) };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
