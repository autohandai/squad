#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { bundledComputerClient, createComputerUse, NativeComputerClient, runComputerUseProxy } from '../server/computer-use.mjs';
import { handle } from '../server/routes/computer-use.route.mjs';
import { COMPUTER_USE_ASSETS, stageComputerUse } from './stage-computer-use.mjs';

const temporary = await mkdtemp(join(tmpdir(), 'squad-computer-check-'));
let count = 0;
async function check(name, operation) { await operation(); console.log(`ok ${++count} - ${name}`); }
const rpc = (name, args = {}) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
const calls = []; const events = [];
let os = { accessibility: true, screen_recording: true };
const nativeClient = { async request(method, params) {
  calls.push({ method, params });
  if (method === 'tools/list') return { tools: ['get_window_state', 'click', 'kill_app', 'set_config', 'check_permissions'].map((name) => ({ name, description: 'test', inputSchema: { type: 'object' } })) };
  if (params.name === 'check_permissions') return { structuredContent: os };
  if (params.name === 'get_window_state') await writeFile(params.arguments.screenshot_out_file, Buffer.from([137, 80, 78, 71]));
  return { content: [{ type: 'text', text: 'mock result' }] };
}, close() {} };
const service = createComputerUse({ rootDir: temporary, stateDir: temporary, bridgeUrl: 'http://127.0.0.1:19821', nativeClient, emit: (name, value) => events.push({ name, value }) });
const session = await service.createSession({ memberId: 'eva', runId: 'work-one' });
const config = JSON.parse(await readFile(session.configPath, 'utf8'));
const token = config.servers[0].env.AUTOHAND_SQUAD_COMPUTER_USE_TOKEN;
try {
  await check('session credentials never appear in public status', async () => {
    const status = await service.status('eva'); assert.equal(JSON.stringify(status).includes(token), false);
    assert.equal((await stat(session.configPath)).mode & 0o777, 0o600);
    assert.equal(config.servers[0].name, 'autohand-computer-use'); assert.equal(config.servers[0].stdioFraming, 'newline');
    assert.equal(config.servers[0].env.AUTOHAND_SQUAD_COMPUTER_USE_URL, 'http://127.0.0.1:19821/api/computer-use/mcp');
  });
  await check('unknown agent session cannot execute or mint grants', async () => { const before = calls.length; await assert.rejects(service.dispatch('bad-token', rpc('click')), /expired/); assert.equal(calls.length, before); });
  await check('initialize negotiates the pinned CLI protocol without launching native tools', async () => { const before = calls.length; const result = await service.dispatch(token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }); assert.equal(result.protocolVersion, '2024-11-05'); assert.equal(calls.length, before); });
  await check('MCP tool discovery exposes only the bounded Squad tools', async () => { const result = await service.dispatch(token, { jsonrpc: '2.0', id: 1, method: 'tools/list' }); assert.deepEqual(result.tools.map((tool) => tool.name), ['get_window_state', 'click']); });
  await check('default denied grant never reaches native actions', async () => { const before = calls.length; await assert.rejects(service.dispatch(token, rpc('click')), /human/); assert.equal(calls.length, before); });
  await check('observe grant cannot control the desktop', async () => { await service.setGrant('eva', 'observe'); const before = calls.length; await assert.rejects(service.dispatch(token, rpc('click')), /human/); assert.equal(calls.length, before); });
  await check('member grant is never borrowed from another member', async () => { await service.setGrant('noah', 'control'); await assert.rejects(service.dispatch(token, rpc('click')), /human/); });
  await check('a human grant cannot override missing Accessibility', async () => { await service.setGrant('eva', 'control'); os = { accessibility: false, screen_recording: true }; await assert.rejects(service.dispatch(token, rpc('click')), /Accessibility/); assert.equal(calls.at(-1).params.name, 'check_permissions'); });
  await check('missing Screen Recording prevents both observation and control', async () => { os = { accessibility: true, screen_recording: false }; for (const tool of ['get_window_state', 'click']) await assert.rejects(service.dispatch(token, rpc(tool)), /Screen Recording/); });
  await check('nonboolean consent is never interpreted as a grant', async () => { os = { accessibility: 'true', screen_recording: 1 }; await assert.rejects(service.dispatch(token, rpc('click')), /System Settings/); });
  await check('permission polling never requests or probes capture', () => { for (const call of calls.filter((call) => call.params?.name === 'check_permissions')) assert.deepEqual(call.params.arguments, { prompt: false, probe_direct_capture: false }); });
  await check('valid action has server-selected session and strips transport metadata', async () => { os = { accessibility: true, screen_recording: true }; await service.dispatch(token, rpc('click', { session: 'other', _session_id: 'spoof', pid: 5, window_id: 8 })); const last = calls.at(-1); assert.equal(last.params.arguments.session, session.id); assert.equal(last.params.arguments._session_id, undefined); assert.equal(last.params.arguments.pid, 5); });
  await check('first permitted control starts verification recording automatically', () => { const index = calls.findIndex((call) => call.params?.name === 'click'); assert.equal(calls[index - 1].params.name, 'start_recording'); assert.equal(calls[index - 1].params.arguments.record_video, false); assert.equal(calls[index - 1].params.arguments.session, session.id); });
  await check('unknown and policy-escalating native tools stay denied', async () => { for (const name of ['set_config', 'check_permissions', 'escalate_session', 'kill_app', 'eval', 'clipboard_write']) await assert.rejects(service.dispatch(token, rpc(name)), /not available/); });
  await check('invalid argument shapes fail without invoking an action', async () => { await assert.rejects(service.dispatch(token, rpc('click', 'bad')), /object/); assert.equal(calls.at(-1).params.name, 'check_permissions'); });
  await check('screenshot evidence is bounded to work and available as an attachment', async () => {
    const result = await service.dispatch(token, rpc('get_window_state', { screenshot_out_file: '/tmp/escape.png', pid: 5, window_id: 8 }));
    assert.ok(calls.at(-1).params.arguments.screenshot_out_file.startsWith(join(temporary, 'computer-use-evidence', session.id)));
    assert.equal(result._meta.squad.evidence.length, 1); const evidence = result._meta.squad.evidence[0]; assert.equal(evidence.mediaType, 'image/png');
    assert.equal((await service.readEvidence(session.id, evidence.name)).bytes.length, 4);
    assert.ok(events.some((event) => event.name === 'computer-use.evidence' && event.value.runId === 'work-one'));
  });
  await check('recording paths and optional video are forced by Squad', async () => { await service.dispatch(token, rpc('start_recording', { output_dir: '/tmp/outside', record_video: true })); const args = calls.at(-1).params.arguments; assert.equal(args.output_dir, join(temporary, 'computer-use-evidence', session.id, 'recording')); assert.equal(args.record_video, false); });
  await check('MCP config and symlinks cannot be served as evidence', async () => { await assert.rejects(service.readEvidence(session.id, 'mcp.json'), /not found/); await assert.rejects(service.readEvidence(session.id, '../../computer-use-grants.json'), /not found/); await symlink(join(temporary, 'computer-use-grants.json'), join(temporary, 'computer-use-evidence', session.id, 'leak.json')); assert.ok(!(await service.evidence(session.id)).some((file) => file.name === 'leak.json')); });
  await check('revocation applies to an existing connected session', async () => { await service.setGrant('eva', 'none'); await assert.rejects(service.dispatch(token, rpc('click')), /human/); });
  await check('revocation stops the member recording immediately', () => { assert.equal(calls.at(-1).params.name, 'stop_recording'); assert.equal(calls.at(-1).params.arguments.session, session.id); });
  await check('closed credentials expire while completed evidence remains', async () => { await service.closeSession(session.id); await assert.rejects(service.dispatch(token, rpc('click')), /expired/); assert.equal((await service.evidence(session.id)).length, 1); });
  await check('completed evidence survives a bridge restart without restoring credentials', async () => { const fresh = createComputerUse({ rootDir: temporary, stateDir: temporary, bridgeUrl: 'http://127.0.0.1:19821' }); const files = await fresh.evidence(session.id); assert.equal(files.length, 1); assert.equal((await fresh.readEvidence(session.id, files[0].name)).bytes.length, 4); await assert.rejects(fresh.dispatch(token, rpc('click')), /expired/); await assert.rejects(fresh.readEvidence(session.id, '.squad-session.json'), /not found/); });
  await check('grant scope validation is strict', async () => { await assert.rejects(service.setGrant('eva', 'unrestricted'), /scope/); await assert.rejects(service.setGrant('', 'control'), /identity/); });
  await check('permission grants persist across bridge restart', async () => { await service.setGrant('eva', 'observe'); const fresh = createComputerUse({ rootDir: temporary, stateDir: temporary, bridgeUrl: 'http://127.0.0.1:19821' }); assert.equal((await fresh.status('eva')).grant.scope, 'observe'); assert.equal((await fresh.status('eva')).available, false); });
  await check('durable member listing finds completed sessions without restoring credentials', async () => { const fresh = createComputerUse({ rootDir: temporary, stateDir: temporary, bridgeUrl: 'http://127.0.0.1:19821' }); const listing = await fresh.listEvidence('eva'); assert.equal(listing.sessions[0].id, session.id); assert.equal(listing.sessions[0].runId, 'work-one'); assert.equal(listing.sessions[0].files.length, 1); assert.equal((await fresh.listEvidence('someone-else')).sessions.length, 0); });
  await check('bundled but unsupported OS reports truthful readiness without launching a process', async () => { const adapter = new NativeComputerClient({ command: '/never-started', args: [], startupError: 'Built-in Computer Use requires macOS 13 or later.', spawnProcess() { throw Error('must not launch'); } }); const fresh = createComputerUse({ rootDir: temporary, stateDir: temporary, nativeClient: adapter }); const state = await fresh.status('eva'); assert.equal(state.bundled, true); assert.equal(state.available, false); assert.match(state.readinessError, /macOS 13/); });

  async function route(method, path, body, extra = {}) { let response; const res = { writeHead(status, headers) { response = { status, headers }; }, end(bytes) { response.bytes = bytes; } }; const ctx = { computerUse: service, readBody: async () => body, json(_res, status, payload) { response = { status, payload }; }, ...extra }; await handle({ method, headers: {} }, res, new URL(path, 'http://127.0.0.1:19821'), ctx); return response; }
  await check('browser and agent requests cannot self-grant without native human confirmation', async () => { const response = await route('POST', '/api/computer-use/grant', { memberId: 'eva', scope: 'control' }); assert.equal(response.status, 403); assert.equal((await service.status('eva')).grant.scope, 'observe'); });
  await check('exact native confirmation enables the requested member grant', async () => { let received; const response = await route('POST', '/api/computer-use/grant', { memberId: 'eva', scope: 'control' }, { authorizeComputerUseGrant: async (_req, body) => { received = body; return true; } }); assert.equal(response.status, 200); assert.deepEqual(received, { memberId: 'eva', scope: 'control' }); });
  await check('a callback returning a truthy object cannot authorize', async () => { assert.equal((await route('POST', '/api/computer-use/grant', { memberId: 'eva', scope: 'control' }, { authorizeComputerUseGrant: async () => ({ approved: true }) })).status, 403); });
  await check('revocation needs no elevation and never grants access', async () => { assert.equal((await route('DELETE', '/api/computer-use/grant', { memberId: 'eva' })).status, 200); assert.equal((await service.status('eva')).grant.scope, 'none'); });
  await check('evidence HTTP returns PNG with no-store and nosniff', async () => { const evidence = (await service.evidence(session.id))[0]; const response = await route('GET', evidence.url); assert.equal(response.headers['content-type'], 'image/png'); assert.equal(response.headers['cache-control'], 'no-store'); assert.equal(response.headers['x-content-type-options'], 'nosniff'); });
  await check('unconfigured runtime reports unavailable', async () => { assert.equal((await route('GET', '/api/computer-use/status', {}, { computerUse: null })).status, 503); });

  async function proxy(input, fetchRequest) { let output = ''; await runComputerUseProxy({ input: Readable.from(input), output: { write(value) { output += value.toString(); } }, url: 'http://127.0.0.1:19821/api/computer-use/mcp', token: 'mock-session', fetchRequest }); return output; }
  const fetchRequest = async (_url, options) => { assert.equal(options.headers['x-squad-computer-token'], 'mock-session'); return { ok: true, json: async () => ({ success: true, data: { echoed: JSON.parse(options.body).method } }) }; };
  await check('stdio proxy accepts fragmented newline framing', async () => { const body = JSON.stringify(rpc('click')); const output = await proxy([body.slice(0, 4), body.slice(4), '\n'], fetchRequest); assert.equal(JSON.parse(output).result.echoed, 'tools/call'); });
  await check('stdio proxy accepts fragmented Content-Length framing', async () => { const body = JSON.stringify(rpc('click')); const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`; const output = await proxy([header.slice(0, 6), header.slice(6), body], fetchRequest); assert.ok(output.startsWith('Content-Length:')); assert.equal(JSON.parse(output.split('\r\n\r\n')[1]).id, 1); });
  await check('permission denial is an MCP error rather than fabricated success', async () => { const output = await proxy([`${JSON.stringify(rpc('click'))}\n`], async () => ({ ok: false, json: async () => ({ success: false, error: 'Human grant required' }) })); assert.match(JSON.parse(output).error.message, /Human grant/); });
  await check('stdio proxy rejects a remote or wrong-route endpoint', async () => { for (const url of ['https://127.0.0.1/api/computer-use/mcp', 'http://example.com/api/computer-use/mcp', 'http://127.0.0.1/api/runs']) await assert.rejects(runComputerUseProxy({ url, token: 'mock', input: Readable.from([]) }), /local Squad/); });
  await check('native adapter initializes one process and pins standard consent mode', async () => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); let options; const messages = []; child.kill = () => {};
    child.stdin = { write(value, callback) { const message = JSON.parse(value); messages.push(message); if (message.id !== undefined) queueMicrotask(() => child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } })}\n`)); callback?.(); } };
    const adapter = new NativeComputerClient({ command: '/mock/host', args: ['mcp'], env: { AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN: 'private-native-fixture' }, spawnProcess(_command, _args, value) { options = value; return child; } });
    await adapter.request('tools/list', {}); await adapter.request('tools/list', {}); assert.equal(messages.filter((message) => message.method === 'initialize').length, 1);
    assert.equal(options.env.CUA_DRIVER_PERMISSION_MODE, 'standard'); assert.equal(options.env.CUA_DRIVER_EMBEDDED, '1'); assert.equal(options.env.CUA_DRIVER_RS_TELEMETRY_ENABLED, '0'); assert.equal(options.env.AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN, undefined); adapter.close();
    assert.equal(options.env.CUA_DRIVER_HOST_BUNDLE_ID, 'ai.autohand.squad.computer-use');
  });
  await check('macOS host identity must belong to Squad rather than the shared driver host', async () => {
    if (process.platform !== 'darwin') return;
    const directory = join(temporary, 'identity-fixture', 'vendor', 'computer-use'); await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'driver'), 'mock'); await writeFile(join(directory, 'host'), 'mock');
    const item = (path) => ({ path, sha256: createHash('sha256').update('mock').digest('hex') });
    const metadata = { version: '0.28.2', repository: 'autohandai/computer-use', driver: item('driver'), host: { ...item('host'), bundleId: 'ai.autohand.computer-use' } };
    await writeFile(join(directory, 'BUILD_INFO.json'), JSON.stringify(metadata));
    await assert.rejects(bundledComputerClient(join(temporary, 'identity-fixture')), /permission identity/);
    metadata.host.bundleId = 'ai.autohand.squad.computer-use'; await writeFile(join(directory, 'BUILD_INFO.json'), JSON.stringify(metadata));
    const adapter = await bundledComputerClient(join(temporary, 'identity-fixture')); assert.equal(adapter.command, await realpath(join(directory, 'host'))); adapter.close();
  });
  await check('runtime checksum detects a changed bundled driver', async () => { const directory = join(temporary, 'vendor', 'computer-use'); await mkdir(directory, { recursive: true }); await writeFile(join(directory, 'cua-driver'), 'changed'); await writeFile(join(directory, 'BUILD_INFO.json'), JSON.stringify({ version: '0.28.2', repository: 'autohandai/computer-use', driver: { path: 'cua-driver', sha256: createHash('sha256').update('original').digest('hex') } })); await assert.rejects(bundledComputerClient(temporary), /checksum/); });
  await check('stage refuses an archive that differs from the immutable digest', async () => { const asset = COMPUTER_USE_ASSETS[`${process.platform}/${process.arch}`]; await writeFile(join(temporary, asset.name), 'not the release'); let extracted = false; await assert.rejects(stageComputerUse({ rootDir: temporary, runtimeDir: join(temporary, 'stage'), sourceDir: temporary, runCommand() { extracted = true; } }), /checksum/); assert.equal(extracted, false); });
  console.log(`${count} Computer Use checks passed; native actions, consent and HTTP requests were mocked.`);
} finally { service.close(); await rm(temporary, { recursive: true, force: true }); }
