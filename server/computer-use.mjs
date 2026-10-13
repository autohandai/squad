// Squad owns grants and evidence; the bundled engine owns OS consent and actions.
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { release } from 'node:os';
import { readPersistentJson, writePersistentJson } from './persistent-json.mjs';

const OBSERVE = new Set(['list_apps', 'list_windows', 'get_window_state', 'get_desktop_state', 'get_screen_size', 'get_cursor_position', 'verify_state', 'get_session_state', 'start_recording', 'stop_recording', 'get_recording_state']);
const CONTROL = new Set(['launch_app', 'bring_to_front', 'set_window_frame', 'invoke_menu', 'click', 'double_click', 'right_click', 'drag', 'type_text', 'press_key', 'hotkey', 'set_value', 'scroll', 'move_cursor']);
const MAX_MESSAGE = 32 * 1024 * 1024;
const MAX_EVIDENCE = 20 * 1024 * 1024;
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function id(value) { if (typeof value !== 'string' || !value.trim() || value.length > 200 || ['__proto__', 'constructor', 'prototype'].includes(value.trim())) throw error('A member identity is required.'); return value.trim(); }
function content(result) {
  if (record(result?.structuredContent)) return result.structuredContent;
  for (const part of result?.content || []) { if (part.type === 'text') { try { const parsed = JSON.parse(part.text); if (record(parsed)) return parsed; } catch {} } }
  return {};
}

export async function bundledComputerClient(rootDir, options = {}) {
  const directory = join(rootDir, 'vendor', 'computer-use');
  const metadata = JSON.parse(await readFile(join(directory, 'BUILD_INFO.json'), 'utf8'));
  if (metadata.version !== '0.28.2' || metadata.repository !== 'autohandai/computer-use' || !record(metadata.driver)) throw error('Computer Use build identity is invalid.', 503);
  async function verifiedFile(item) {
    if (!record(item) || typeof item.path !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256 || '')) throw error('Computer Use build manifest is invalid.', 503);
    const filename = await realpath(resolve(directory, item.path));
    if (!filename.startsWith(`${await realpath(directory)}${sep}`)) throw error('Computer Use runtime path is invalid.', 503);
    if (createHash('sha256').update(await readFile(filename)).digest('hex') !== item.sha256) throw error('Computer Use runtime checksum failed.', 503);
    return filename;
  }
  const driver = await verifiedFile(metadata.driver);
  if (process.platform === 'darwin') {
    if (metadata.host?.bundleId !== 'ai.autohand.squad.computer-use') throw error('Computer Use permission identity is invalid.', 503);
    return new NativeComputerClient({ command: await verifiedFile(metadata.host), args: ['mcp', '--driver-path', driver], startupError: Number(release().split('.')[0]) < 22 ? 'Built-in Computer Use requires macOS 13 or later. Squad can still be used on this version of macOS.' : '', ...options });
  }
  return new NativeComputerClient({ command: driver, args: ['mcp'], ...options });
}

/** Native newline JSON-RPC. No shell, inherited stdio, permission prompts or driver telemetry. */
export class NativeComputerClient {
  constructor({ command, args, env = {}, spawnProcess = spawn, timeoutMs = 30000, startupError = '' }) {
    this.command = command; this.args = args; this.env = env; this.spawnProcess = spawnProcess; this.timeoutMs = timeoutMs;
    this.pending = new Map(); this.sequence = 0; this.buffer = ''; this.starting = null; this.child = null;
    this.startupError = startupError;
  }
  async start() {
    if (this.startupError) throw error(this.startupError, 503);
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const env = { ...process.env, ...this.env, CUA_DRIVER_PERMISSION_MODE: 'standard', CUA_DRIVER_RS_TELEMETRY_ENABLED: '0', CUA_DRIVER_EMBEDDED: '1', CUA_DRIVER_HOST_BUNDLE_ID: 'ai.autohand.squad.computer-use' };
      delete env.AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN;
      const child = this.spawnProcess(this.command, this.args, { stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: true });
      this.child = child;
      child.stdout.on('data', (chunk) => {
        this.buffer += chunk.toString();
        if (this.buffer.length > MAX_MESSAGE) { this.close(); return; }
        let end;
        while ((end = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
          let response; try { response = JSON.parse(line); } catch { continue; }
          const pending = this.pending.get(response.id); if (!pending) continue;
          this.pending.delete(response.id); clearTimeout(pending.timer);
          if (response.error) pending.reject(error(response.error.message || 'Computer Use failed.', 502)); else pending.resolve(response.result);
        }
      });
      child.stderr.on('data', () => {}); // Never leak screen content or driver diagnostics into chat logs.
      child.on('error', (failure) => { if (this.child === child) this.fail(failure); });
      child.on('close', () => { if (this.child === child) this.fail(error('Computer Use connection closed.', 503)); });
      await this.send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'autohand-squad', version: '1' } });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    })();
    try { await this.starting; } catch (failure) { this.close(); throw failure; }
  }
  send(method, params) {
    return new Promise((resolveResult, reject) => {
      const requestId = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(error('Computer Use request timed out.', 504)); }, this.timeoutMs);
      this.pending.set(requestId, { resolve: resolveResult, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params })}\n`, (failure) => { if (failure) { clearTimeout(timer); this.pending.delete(requestId); reject(failure); } });
    });
  }
  async request(method, params) { await this.start(); return this.send(method, params); }
  fail(failure) { for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(failure); } this.pending.clear(); this.starting = null; this.child = null; }
  close() { this.child?.kill(); this.fail(error('Computer Use stopped.', 503)); }
}

export function createComputerUse({ stateDir, rootDir, bridgeUrl, nativeClient, emit = () => {}, now = () => Date.now() }) {
  const grantsFile = join(stateDir, 'computer-use-grants.json');
  const evidenceRoot = join(stateDir, 'computer-use-evidence');
  const sessions = new Map();
  const byToken = new Map();
  let queue = Promise.resolve();
  const serial = (operation) => { const pending = queue.then(operation); queue = pending.catch(() => {}); return pending; };
  async function grants() { const value = await readPersistentJson(grantsFile, { version: 1, members: {} }); if (!record(value.members)) throw error('Computer Use grant store is invalid.', 503); return value; }
  async function permission() {
    if (!nativeClient) return { accessibility: false, screenRecording: false, available: false };
    const response = await nativeClient.request('tools/call', { name: 'check_permissions', arguments: { prompt: false, probe_direct_capture: false } });
    const result = content(response);
    if (response?.isError === true || typeof result.accessibility !== 'boolean' || typeof result.screen_recording !== 'boolean') throw error('Accessibility and Screen Recording state could not be confirmed in System Settings.', 403);
    return { accessibility: result.accessibility === true, screenRecording: result.screen_recording === true, available: true };
  }
  async function status(memberId) {
    const stored = await grants();
    let os; let readinessError = null;
    try { os = await serial(permission); } catch (failure) { os = { available: false, accessibility: false, screenRecording: false }; readinessError = String(failure.message || 'Could not confirm Computer Use readiness.').slice(0, 240); }
    return { ...os, bundled: Boolean(nativeClient), readinessError, memberId: memberId || null, grant: memberId ? stored.members[id(memberId)] || { scope: 'none' } : null, sessions: [...sessions.values()].filter((session) => !memberId || session.memberId === memberId).map(publicSession) };
  }
  async function setGrant(memberId, scope) {
    memberId = id(memberId);
    if (!['none', 'observe', 'control'].includes(scope)) throw error('Computer Use scope must be none, observe or control.');
    return serial(async () => {
      const stored = await grants(); const grant = { scope, updatedAt: new Date(now()).toISOString() }; stored.members[memberId] = grant;
      await writePersistentJson(grantsFile, stored);
      if (scope === 'none' && nativeClient) {
        for (const session of sessions.values()) {
          if (session.memberId !== memberId || !session.recording) continue;
          await nativeClient.request('tools/call', { name: 'stop_recording', arguments: { session: session.id } }).catch(() => {});
          session.recording = false;
        }
      }
      emit('computer-use.grant', { memberId, scope });
      return grant;
    });
  }
  function publicSession(session) { return { id: session.id, memberId: session.memberId, runId: session.runId, createdAt: session.createdAt }; }
  async function storedSession(sessionId) {
    if (sessions.has(sessionId)) return sessions.get(sessionId);
    if (typeof sessionId !== 'string' || !/^[a-f0-9-]{36}$/.test(sessionId)) throw error('Computer Use session not found.', 404);
    const directory = join(evidenceRoot, sessionId);
    const metadata = await readPersistentJson(join(directory, '.squad-session.json'), null);
    if (!record(metadata) || metadata.id !== sessionId || typeof metadata.memberId !== 'string') throw error('Computer Use session not found.', 404);
    const session = { id: sessionId, memberId: metadata.memberId, runId: metadata.runId, createdAt: metadata.createdAt, directory };
    sessions.set(sessionId, session); return session;
  }
  async function createSession({ memberId, runId = '', nodePath = process.execPath }) {
    memberId = id(memberId);
    const sessionId = randomUUID(); const token = randomBytes(32).toString('hex');
    const session = { id: sessionId, memberId, runId: String(runId), createdAt: new Date(now()).toISOString(), token, directory: join(evidenceRoot, sessionId) };
    await mkdir(session.directory, { recursive: true, mode: 0o700 });
    const configPath = join(session.directory, 'mcp.json');
    const config = { servers: [{ name: 'autohand-computer-use', transport: 'stdio', stdioFraming: 'newline', command: nodePath, args: [join(rootDir, 'server', 'computer-use.mjs'), '--mcp'], autoConnect: true, env: { AUTOHAND_SQUAD_COMPUTER_USE_URL: `${new URL('/api/computer-use/mcp', bridgeUrl)}`, AUTOHAND_SQUAD_COMPUTER_USE_TOKEN: token } }] };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await writePersistentJson(join(session.directory, '.squad-session.json'), publicSession(session));
    sessions.set(sessionId, session); byToken.set(token, session);
    // Internal launch data: mcpServer contains the credential. Never expose
    // this return value through public status/run summaries.
    return { ...publicSession(session), configPath, mcpServer: config.servers[0] };
  }
  async function dispatch(token, request) {
    const session = byToken.get(token); if (!session) throw error('Computer Use session has expired.', 401);
    if (!record(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string') throw error('Invalid Computer Use request.');
    if (request.method === 'initialize') return { protocolVersion: ['2024-11-05', '2025-06-18'].includes(request.params?.protocolVersion) ? request.params.protocolVersion : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'autohand-squad-computer-use', version: '1' } };
    if (request.method === 'ping' || request.method.startsWith('notifications/')) return {};
    return serial(async () => {
      if (!byToken.has(token)) throw error('Computer Use session has expired.', 401);
      if (!nativeClient) throw error('Bundled Computer Use is unavailable.', 503);
      if (request.method === 'tools/list') {
        const result = await nativeClient.request('tools/list', {});
        return { tools: (result?.tools || []).filter((tool) => OBSERVE.has(tool.name) || CONTROL.has(tool.name)).map((tool) => ({ ...tool, description: `${tool.description || ''}\nSquad requires a human Computer Use grant and OS consent. Evidence is saved with this work.` })) };
      }
      if (request.method !== 'tools/call') throw error('Unsupported Computer Use method.');
      const tool = request.params?.name; const scope = CONTROL.has(tool) ? 'control' : OBSERVE.has(tool) ? 'observe' : null;
      if (!scope) throw error('This Computer Use tool is not available through Squad.', 403);
      const grant = (await grants()).members[session.memberId]?.scope;
      if (grant !== 'control' && !(grant === 'observe' && scope === 'observe')) throw error('Ask the human to allow Computer Use in this member’s permissions.', 403);
      const os = await permission();
      if (!os.accessibility || !os.screenRecording) throw error('Allow Accessibility and Screen Recording for Squad Computer Use in System Settings.', 403);
      const incoming = request.params.arguments ?? {};
      if (!record(incoming)) throw error('Computer Use arguments must be an object.');
      const args = { ...incoming, session: session.id };
      for (const key of Object.keys(args)) if (key.startsWith('_')) delete args[key];
      // Tools exposed here cannot select external screenshot/recording files.
      delete args.screenshot_out_file; delete args.output_dir;
      if (tool === 'get_window_state') args.screenshot_out_file = join(session.directory, `capture-${randomUUID()}.png`);
      if (tool === 'start_recording') { args.output_dir = join(session.directory, 'recording'); args.record_video = false; }
      // Every desktop control operation has before/after evidence, without
      // requiring the agent to remember a separate setup tool.
      if (scope === 'control' && !session.recording) {
        const recording = await nativeClient.request('tools/call', { name: 'start_recording', arguments: { session: session.id, output_dir: join(session.directory, 'recording'), record_video: false } });
        if (recording?.isError === true) throw error('Computer Use could not start verification recording.', 502);
        session.recording = true;
      }
      const result = await nativeClient.request('tools/call', { name: tool, arguments: args });
      if (tool === 'start_recording' && result?.isError !== true) session.recording = true;
      if (tool === 'stop_recording' && result?.isError !== true) session.recording = false;
      emit('computer-use.action', { memberId: session.memberId, runId: session.runId, sessionId: session.id, tool, success: result?.isError !== true });
      const files = await evidence(session.id);
      if (files.length) emit('computer-use.evidence', { memberId: session.memberId, runId: session.runId, sessionId: session.id, files });
      return { ...result, _meta: { ...result?._meta, squad: { sessionId: session.id, evidence: files } } };
    });
  }
  async function evidence(sessionId) {
    const session = await storedSession(sessionId);
    const files = [];
    async function walk(directory, depth = 0) {
      if (depth > 4 || files.length >= 200) return;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (files.length >= 200) return;
        const filename = join(directory, entry.name);
        if (entry.isDirectory()) await walk(filename, depth + 1);
        else if (entry.isFile() && /\.(png|json)$/.test(entry.name) && entry.name !== 'mcp.json' && !entry.name.startsWith('.')) {
          const info = await stat(filename); if (info.size > MAX_EVIDENCE) continue;
          const name = relative(session.directory, filename).split(sep).join('/');
          files.push({ name, size: info.size, url: `/api/computer-use/evidence/${session.id}/${name.split('/').map(encodeURIComponent).join('/')}`, mediaType: entry.name.endsWith('.png') ? 'image/png' : 'application/json' });
        }
      }
    }
    await walk(session.directory); return files;
  }
  async function readEvidence(sessionId, name) {
    const session = await storedSession(sessionId);
    const allowed = (await evidence(sessionId)).find((file) => file.name === name); if (!allowed) throw error('Evidence not found.', 404);
    const filename = await realpath(resolve(session.directory, name));
    if (!filename.startsWith(`${await realpath(session.directory)}${sep}`)) throw error('Evidence path is outside this work.', 403);
    return { ...allowed, bytes: await readFile(filename) };
  }
  async function listEvidence(memberId) {
    memberId = id(memberId);
    const entries = await readdir(evidenceRoot, { withFileTypes: true }).catch((failure) => { if (failure.code === 'ENOENT') return []; throw failure; });
    const records = [];
    for (const entry of entries.filter((item) => item.isDirectory() && /^[a-f0-9-]{36}$/.test(item.name)).slice(-1000)) {
      const session = await storedSession(entry.name).catch(() => null);
      if (session?.memberId === memberId) records.push(session);
    }
    const recent = records.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 50);
    const listed = [];
    for (const session of recent) listed.push({ ...publicSession(session), files: await evidence(session.id) });
    return { memberId, sessions: listed, truncated: records.length > 50 || entries.length > 1000 };
  }
  async function closeSession(sessionId) {
    const session = sessions.get(sessionId); if (!session) return;
    byToken.delete(session.token);
    if (nativeClient) await serial(() => nativeClient.request('tools/call', { name: 'end_session', arguments: { session: session.id } })).catch(() => {});
    const files = await evidence(session.id);
    if (files.length) emit('computer-use.evidence', { memberId: session.memberId, runId: session.runId, sessionId: session.id, files });
    // Keep evidence readable after work finishes; only the live credential expires.
  }
  return { status, setGrant, createSession, dispatch, evidence, listEvidence, readEvidence, closeSession, close: () => { byToken.clear(); nativeClient?.close(); } };
}

/** SDK-facing stdio proxy. Accept both conventional MCP framing formats. */
export async function runComputerUseProxy({ input = process.stdin, output = process.stdout, url = process.env.AUTOHAND_SQUAD_COMPUTER_USE_URL, token = process.env.AUTOHAND_SQUAD_COMPUTER_USE_TOKEN, fetchRequest = fetch } = {}) {
  delete process.env.AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN;
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname) || endpoint.pathname !== '/api/computer-use/mcp' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !token) throw error('A local Squad Computer Use session is required.');
  let buffer = Buffer.alloc(0); let pending = Promise.resolve();
  async function receive(body, framing) {
    let request;
    try {
      request = JSON.parse(body.toString());
      if (request.id === undefined) return;
      const response = await fetchRequest(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-squad-computer-token': token }, body: JSON.stringify(request), signal: AbortSignal.timeout(45000) });
      const envelope = await response.json();
      if (!response.ok || envelope.success !== true) throw error(envelope.error || 'Computer Use request failed.');
      write({ jsonrpc: '2.0', id: request.id, result: envelope.data }, framing);
    } catch (failure) { write({ jsonrpc: '2.0', id: request?.id ?? null, error: { code: -32000, message: failure.message } }, framing); }
  }
  function write(response, framing) { const encoded = Buffer.from(JSON.stringify(response)); output.write(framing === 'header' ? Buffer.concat([Buffer.from(`Content-Length: ${encoded.length}\r\n\r\n`), encoded]) : Buffer.concat([encoded, Buffer.from('\n')])); }
  for await (const chunk of input) {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]); if (buffer.length > MAX_MESSAGE) throw error('Computer Use message exceeds its size limit.');
    while (buffer.length) {
      if (buffer.subarray(0, 15).toString().toLowerCase().startsWith('content-length:')) {
        const end = buffer.indexOf('\r\n\r\n'); if (end < 0) break;
        const match = buffer.subarray(0, end).toString().match(/^Content-Length:\s*(\d+)/i); const size = Number(match?.[1]);
        if (!Number.isSafeInteger(size) || size > MAX_MESSAGE) throw error('Invalid Computer Use message size.');
        if (buffer.length < end + 4 + size) break;
        const body = buffer.subarray(end + 4, end + 4 + size); buffer = buffer.subarray(end + 4 + size); pending = pending.then(() => receive(body, 'header'));
      } else { const end = buffer.indexOf('\n'); if (end < 0) break; const body = buffer.subarray(0, end); buffer = buffer.subarray(end + 1); if (body.length) pending = pending.then(() => receive(body, 'newline')); }
    }
  }
  await pending;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--mcp')) runComputerUseProxy().catch(() => { process.stderr.write('Squad Computer Use connection failed.\n'); process.exitCode = 1; });
