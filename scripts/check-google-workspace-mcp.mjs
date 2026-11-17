#!/usr/bin/env node
// Squad's Google Workspace MCP server against local fakes only: a fake bridge
// runtime endpoint that hands out access tokens, and a fake Google API that
// serves canned Gmail / Drive / Calendar JSON. No real Google account, no
// network. Each product runs in both MCP framings.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createFrameReader, encodeMessage } from '../server/connectors/framing.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const serverPath = resolve(root, 'server/connectors/google-workspace-mcp.mjs');
const CONNECTOR_TOKEN = 'conn-secret-7f2a';
const TOKENS = ['tok-1', 'tok-2'];
const children = new Set();
const outputs = [];
const readBody = (req) => new Promise((done) => { let data = ''; req.on('data', (c) => { data += c; }); req.on('end', () => done(data)); });
const listen = (server) => new Promise((done) => server.listen(0, '127.0.0.1', () => done(server.address().port)));

// --- fake bridge runtime endpoint ---
const bridgeCalls = { fresh: 0, stale: 0, refused: 0 };
const bridge = createServer(async (req, res) => {
  const json = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  const body = JSON.parse(await readBody(req) || '{}');
  if (req.method !== 'POST' || req.url !== '/api/connectors/runtime' || req.headers['x-squad-connector-token'] !== CONNECTOR_TOKEN || req.headers['content-type'] !== 'application/json') { bridgeCalls.refused += 1; return json(401, { success: false, error: 'Squad did not recognise this connector session.' }); }
  if (body.id === 'gw-broken') return json(200, { success: false, error: 'Sign in to Google again in Settings › Connectors.' });
  assert.equal(body.id, 'gw-1'); assert.equal(body.want, 'access-token'); assert.equal(typeof body.stale, 'boolean');
  bridgeCalls[body.stale ? 'stale' : 'fresh'] += 1;
  return json(200, { success: true, data: { accessToken: body.stale ? 'tok-2' : 'tok-1', expiresAt: Math.floor(Date.now() / 1000) + 3600 } });
});

// --- fake Google API ---
const seen = [];
const fake = { throttled: false };
const b64 = (value) => Buffer.from(value, 'utf8').toString('base64url');
const headersOf = (from, subject) => [{ name: 'From', value: from }, { name: 'To', value: 'me@example.test' }, { name: 'Subject', value: subject }, { name: 'Date', value: 'Tue, 17 Nov 2026 09:00:00 +1000' }];
const MESSAGES = {
  m1: { id: 'm1', threadId: 't1', snippet: 'Quarterly numbers &amp; notes', labelIds: ['INBOX'], payload: { mimeType: 'multipart/mixed', headers: headersOf('Ana <ana@example.test>', 'Q4 plan'), parts: [{ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64('Hello team,\nthe plan is attached. Olá!') } }, { mimeType: 'text/html', body: { data: b64('<p>ignored</p>') } }] }, { mimeType: 'application/pdf', filename: 'plan.pdf', body: { attachmentId: 'att1', size: 48213 } }] } },
  m2: { id: 'm2', threadId: 't2', snippet: 'Lunch?', payload: { mimeType: 'text/html', headers: headersOf('bo@example.test', 'Lunch'), body: { data: b64('<html><style>p{}</style><p>Lunch at <b>noon</b>?</p><p>Tom &amp; Jerry</p></html>') } } },
  mbig: { id: 'mbig', threadId: 't3', payload: { mimeType: 'text/plain', headers: headersOf('big@example.test', 'Big'), body: { data: b64('y'.repeat(30000)) } } },
};
const FILES = {
  doc1: { id: 'doc1', name: 'Roadmap', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-11-16T10:00:00Z', webViewLink: 'https://docs.google.com/document/d/doc1', owners: [{ displayName: 'Ana' }] },
  sheet1: { id: 'sheet1', name: 'Budget', mimeType: 'application/vnd.google-apps.spreadsheet', owners: [] },
  txt1: { id: 'txt1', name: 'notes.md', mimeType: 'text/markdown', size: '12', owners: [] },
  pdf1: { id: 'pdf1', name: 'scan.pdf', mimeType: 'application/pdf', size: '900', owners: [] },
  draw1: { id: 'draw1', name: 'Sketch', mimeType: 'application/vnd.google-apps.drawing', owners: [] },
};
const google = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://fake');
  const body = await readBody(req);
  const auth = req.headers.authorization || '';
  const json = (status, value, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(value)); };
  const plain = (value) => { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end(value); };
  seen.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), all: url.searchParams, auth, body: body ? JSON.parse(body) : null });
  if (!TOKENS.some((token) => auth === `Bearer ${token}`)) return json(401, { error: { code: 401, message: 'Invalid Credentials' } });
  const p = url.pathname;
  // Gmail
  if (p === '/gmail/v1/users/me/messages' && req.method === 'GET') {
    if (url.searchParams.get('q') === 'scope') return json(403, { error: { code: 403, message: 'Request had insufficient authentication scopes.', status: 'PERMISSION_DENIED', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } });
    return json(200, { messages: [{ id: 'm1', threadId: 't1' }, { id: 'm2', threadId: 't2' }], resultSizeEstimate: 2 });
  }
  const message = p.match(/^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/);
  if (message && req.method === 'GET') return MESSAGES[message[1]] ? json(200, MESSAGES[message[1]]) : json(404, { error: { code: 404, message: 'Requested entity was not found.' } });
  if (p === '/gmail/v1/users/me/drafts' && req.method === 'POST') return json(200, { id: 'd1', message: { id: 'm9', threadId: 't9' } });
  if (p === '/gmail/v1/users/me/messages/send' && req.method === 'POST') return json(200, { id: 'm10', threadId: 't10', labelIds: ['SENT'] });
  // Drive
  if (p === '/drive/v3/files' && req.method === 'GET') {
    if (url.searchParams.get('orderBy') && !fake.throttled) { fake.throttled = true; return json(429, { error: { code: 429, message: 'Rate limit' } }, { 'retry-after': '0' }); }
    return json(200, { files: [FILES.doc1, FILES.txt1] });
  }
  const file = p.match(/^\/drive\/v3\/files\/([^/]+)(\/export)?$/);
  if (file && req.method === 'GET') {
    if (file[1] === 'echo1') return json(400, { error: { code: 400, message: `Bad request with header ${auth}` } });
    if (file[1] === 'off1') return json(403, { error: { code: 403, message: 'Google Drive API has not been used in project 123 before or it is disabled.', errors: [{ reason: 'accessNotConfigured' }] } });
    const meta = FILES[file[1]];
    if (!meta) return json(404, { error: { code: 404, message: 'File not found.' } });
    if (file[2]) return plain(file[1] === 'doc1' ? `Roadmap text\n${'z'.repeat(20000)}` : 'a,b\n1,2\n');
    if (url.searchParams.get('alt') === 'media') return plain('# Notes\nhello');
    return json(200, meta);
  }
  // Calendar
  if (p === '/calendar/v3/calendars/primary/events' && req.method === 'GET') {
    if (auth === 'Bearer tok-1') return json(401, { error: { code: 401, message: 'Invalid Credentials' } });
    return json(200, { items: [{ id: 'e1', summary: 'Standup', start: { dateTime: '2026-11-18T09:00:00+10:00' }, end: { dateTime: '2026-11-18T09:15:00+10:00' }, attendees: [{ email: 'ana@example.test' }], htmlLink: 'https://calendar.google.com/e1' }, { id: 'e2', summary: 'Holiday', start: { date: '2026-11-20' }, end: { date: '2026-11-21' } }] });
  }
  if (p.startsWith('/calendar/v3/calendars/') && p.endsWith('/events') && req.method === 'POST') {
    const event = JSON.parse(body);
    return json(200, { id: 'e9', status: 'confirmed', htmlLink: 'https://calendar.google.com/e9', ...event });
  }
  return json(404, { error: { code: 404, message: 'fixture route not found' } });
});

/** Drive one server process over JSON-RPC in one framing. */
async function session(product, framing, env, steps) {
  fake.throttled = false;
  const child = spawn(process.execPath, [serverPath, '--product', product], { env: { ...process.env, AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN: 'grant-should-vanish', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child);
  const pending = new Map();
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c; });
  const reader = createFrameReader((message, seenFraming) => { const waiter = pending.get(message.id); if (waiter) { pending.delete(message.id); assert.equal(seenFraming, framing, 'the server answers in the framing it was spoken to'); waiter(message); } });
  child.stdout.on('data', (chunk) => reader.feed(chunk));
  let next = 1;
  const rpc = (method, params) => new Promise((done, reject) => { const id = next++; const timer = setTimeout(() => reject(Error(`rpc ${method} timed out: ${stderr}`)), 15000); pending.set(id, (m) => { clearTimeout(timer); done(m); }); child.stdin.write(encodeMessage({ jsonrpc: '2.0', id, method, params }, framing)); });
  const call = async (name, args = {}) => { const reply = await rpc('tools/call', { name, arguments: args }); assert.ok(reply.result, JSON.stringify(reply)); outputs.push(JSON.stringify(reply.result)); return reply.result; };
  try { return await steps({ rpc, call }); }
  finally { child.kill(); children.delete(child); }
}
const textOf = (result) => result.content[0].text;
const ok = (result) => { assert.ok(!result.isError, textOf(result)); return result; };
const err = (result, pattern) => { assert.equal(result.isError, true, textOf(result)); assert.match(textOf(result), pattern); return result; };
const lastSeen = (predicate) => seen.filter(predicate).at(-1);
const decodeRaw = (raw) => {
  const message = Buffer.from(raw, 'base64url').toString('utf8');
  const [head, ...rest] = message.split('\r\n\r\n');
  return { head, body: Buffer.from(rest.join('\r\n\r\n').replace(/\r\n/g, ''), 'base64').toString('utf8') };
};

let passed = 0;
try {
  const [bridgePort, googlePort] = await Promise.all([listen(bridge), listen(google)]);
  const env = { AUTOHAND_SQUAD_CONNECTOR_URL: `http://127.0.0.1:${bridgePort}/api/connectors/runtime`, AUTOHAND_SQUAD_CONNECTOR_TOKEN: CONNECTOR_TOKEN, AUTOHAND_SQUAD_CONNECTOR_ID: 'gw-1', AUTOHAND_SQUAD_GOOGLE_API_BASE: `http://127.0.0.1:${googlePort}` };

  // --- an unknown product is refused before anything starts ---
  const bad = spawnSync(process.execPath, [serverPath, '--product', 'sheets'], { encoding: 'utf8' });
  assert.equal(bad.status, 2); assert.match(bad.stderr, /gmail\|drive\|calendar/); assert.equal(bad.stderr.trim().split('\n').length, 1);

  for (const framing of ['newline', 'header']) {
    // --- Gmail ---
    await session('gmail', framing, env, async ({ rpc, call }) => {
      const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'check', version: '1' } });
      assert.equal(init.result.serverInfo.name, 'squad-google-gmail'); assert.equal(init.result.protocolVersion, '2025-03-26');
      const tools = (await rpc('tools/list', {})).result.tools;
      assert.deepEqual(tools.map((t) => t.name), ['gmail_search', 'gmail_read', 'gmail_create_draft', 'gmail_send']);
      assert.equal(tools.find((t) => t.name === 'gmail_send').annotations.destructiveHint, true);
      assert.equal(tools.find((t) => t.name === 'gmail_search').annotations.readOnlyHint, true);
      assert.equal((await rpc('resources/list', {})).error.code, -32601);
      const before = { ...bridgeCalls };

      const search = ok(await call('gmail_search', { query: 'from:ana newer_than:7d', maxResults: 99 }));
      assert.equal(search.structuredContent.results.length, 2);
      assert.deepEqual(search.structuredContent.results[0], { id: 'm1', threadId: 't1', from: 'Ana <ana@example.test>', to: 'me@example.test', subject: 'Q4 plan', date: 'Tue, 17 Nov 2026 09:00:00 +1000', snippet: 'Quarterly numbers & notes' });
      const list = lastSeen((r) => r.path === '/gmail/v1/users/me/messages');
      assert.equal(list.query.q, 'from:ana newer_than:7d'); assert.equal(list.query.maxResults, '25', 'maxResults is capped at 25');
      const meta = lastSeen((r) => r.path === '/gmail/v1/users/me/messages/m1');
      assert.equal(meta.query.format, 'metadata'); assert.deepEqual(meta.all.getAll('metadataHeaders'), ['From', 'To', 'Subject', 'Date']);
      assert.equal(bridgeCalls.fresh - before.fresh, 1, 'one bridge call serves every request while the token is fresh');

      const read = ok(await call('gmail_read', { id: 'm1' }));
      assert.match(textOf(read), /Hello team,\nthe plan is attached\. Olá!/); assert.ok(!textOf(read).includes('ignored'), 'text/plain wins over text/html');
      assert.deepEqual(read.structuredContent.attachments, [{ filename: 'plan.pdf', mimeType: 'application/pdf', size: 48213 }]);
      assert.match(textOf(read), /plan\.pdf \(48213 bytes\)/);
      assert.equal(lastSeen((r) => r.path === '/gmail/v1/users/me/messages/m1').query.format, 'full');
      const html = ok(await call('gmail_read', { id: 'm2' }));
      assert.equal(html.structuredContent.body, 'Lunch at noon?\nTom & Jerry');
      const big = ok(await call('gmail_read', { id: 'mbig' }));
      assert.ok(textOf(big).length <= 12100); assert.match(textOf(big), /… \d+ more characters not shown/); assert.equal(big.structuredContent.truncated, true);
      err(await call('gmail_read', { id: '../drafts' }), /Gmail message id/);
      err(await call('gmail_read', { id: 'nope' }), /not found/);

      ok(await call('gmail_create_draft', { to: 'ana@example.test, bo@example.test', cc: 'cy@example.test', subject: 'Relatório de café ☕', body: 'Olá,\nsee you.' }));
      const draft = lastSeen((r) => r.path === '/gmail/v1/users/me/drafts');
      const drafted = decodeRaw(draft.body.message.raw);
      assert.match(drafted.head, /^To: ana@example\.test, bo@example\.test\r\nCc: cy@example\.test\r\n/);
      assert.match(drafted.head, new RegExp(`Subject: =\\?UTF-8\\?B\\?${Buffer.from('Relatório de café ☕').toString('base64').replace(/[+/=]/g, '\\$&')}\\?=`));
      assert.match(drafted.head, /Content-Type: text\/plain; charset="UTF-8"/);
      assert.equal(drafted.body, 'Olá,\r\nsee you.');

      const sent = ok(await call('gmail_send', { to: 'ana@example.test', bcc: 'boss@example.test', subject: 'Plain subject', body: 'Done.' }));
      assert.equal(sent.structuredContent.id, 'm10');
      const sendBody = decodeRaw(lastSeen((r) => r.path === '/gmail/v1/users/me/messages/send').body.raw);
      assert.match(sendBody.head, /^To: ana@example\.test\r\nBcc: boss@example\.test\r\nSubject: Plain subject\r\n/); assert.equal(sendBody.body, 'Done.');

      // Header injection is refused before anything reaches Google.
      const sends = seen.filter((r) => r.path.endsWith('/send')).length;
      err(await call('gmail_send', { to: 'ana@example.test\r\nBcc: eve@example.test', subject: 'x', body: 'y' }), /line breaks/);
      err(await call('gmail_send', { to: 'ana@example.test', subject: 'hi\nBcc: eve@example.test', body: 'y' }), /one line/);
      err(await call('gmail_create_draft', { to: 'not-an-address', subject: 'x', body: 'y' }), /isn't an email address/);
      assert.equal(seen.filter((r) => r.path.endsWith('/send')).length, sends);

      err(await call('gmail_search', { query: 'scope' }), /^Google didn't grant this permission\. Sign in to Google again in Settings › Connectors and allow access\.$/);
      err(await call('gmail_nope', {}), /Unknown tool/);
    });

    // --- Drive ---
    await session('drive', framing, env, async ({ rpc, call }) => {
      assert.equal((await rpc('initialize', {})).result.serverInfo.name, 'squad-google-drive');
      assert.deepEqual((await rpc('tools/list', {})).result.tools.map((t) => t.name), ['drive_search', 'drive_recent', 'drive_read']);
      const search = ok(await call('drive_search', { query: "Ana's \\ roadmap" }));
      assert.deepEqual(search.structuredContent.files[0], { id: 'doc1', name: 'Roadmap', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-11-16T10:00:00Z', webViewLink: 'https://docs.google.com/document/d/doc1', owners: ['Ana'] });
      const listed = lastSeen((r) => r.path === '/drive/v3/files');
      assert.equal(listed.query.q, "fullText contains 'Ana\\'s \\\\ roadmap' and trashed = false");
      assert.equal(listed.query.fields, 'files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName))'); assert.equal(listed.query.pageSize, '10');

      // 429 with Retry-After: 0 is retried once and then succeeds.
      const before = seen.length;
      const recent = ok(await call('drive_recent', { maxResults: 3 }));
      assert.equal(recent.structuredContent.files.length, 2);
      const recentCalls = seen.slice(before).filter((r) => r.path === '/drive/v3/files');
      assert.equal(recentCalls.length, 2, '429 then a retry'); assert.equal(recentCalls[1].query.orderBy, 'modifiedTime desc'); assert.equal(recentCalls[1].query.pageSize, '3');

      const doc = ok(await call('drive_read', { fileId: 'doc1' }));
      assert.equal(lastSeen((r) => r.path === '/drive/v3/files/doc1/export').query.mimeType, 'text/plain');
      assert.match(textOf(doc), /^Roadmap\n.*\n.*\n\nRoadmap text\n/); assert.match(textOf(doc), /… \d+ more characters not shown$/);
      assert.ok(textOf(doc).length <= 12100); assert.equal(doc.structuredContent.truncated, true);
      ok(await call('drive_read', { fileId: 'sheet1' }));
      assert.equal(lastSeen((r) => r.path === '/drive/v3/files/sheet1/export').query.mimeType, 'text/csv');
      const md = ok(await call('drive_read', { fileId: 'txt1' }));
      assert.equal(md.structuredContent.text, '# Notes\nhello'); assert.equal(lastSeen((r) => r.path === '/drive/v3/files/txt1').query.alt, 'media');
      const pdf = ok(await call('drive_read', { fileId: 'pdf1' }));
      assert.equal(pdf.structuredContent.readable, false); assert.match(textOf(pdf), /can't be read as text/);
      err(await call('drive_read', { fileId: 'draw1' }), /Google Drawing/);
      err(await call('drive_read', { fileId: 'a/b' }), /fileId must be/);
      err(await call('drive_read', { fileId: 'off1' }), /Google Drive API is not enabled for the Google Cloud project that owns this sign-in/);
      const echoed = err(await call('drive_read', { fileId: 'echo1' }), /^Google answered 400: /);
      assert.match(textOf(echoed), /\[redacted\]/, 'a token Google echoes back is scrubbed');
    });

    // --- Calendar: the first call meets a 401, refreshes with stale:true, then succeeds ---
    await session('calendar', framing, env, async ({ rpc, call }) => {
      assert.equal((await rpc('initialize', {})).result.serverInfo.name, 'squad-google-calendar');
      assert.deepEqual((await rpc('tools/list', {})).result.tools.map((t) => t.name), ['calendar_list_events', 'calendar_create_event']);
      const before = { ...bridgeCalls };
      const listed = ok(await call('calendar_list_events', {}));
      assert.equal(bridgeCalls.stale - before.stale, 1, '401 asked the bridge again with stale:true');
      const tries = seen.filter((r) => r.path === '/calendar/v3/calendars/primary/events').slice(-2);
      assert.deepEqual(tries.map((r) => r.auth), ['Bearer tok-1', 'Bearer tok-2']);
      assert.equal(listed.structuredContent.events.length, 2); assert.equal(listed.structuredContent.events[1].allDay, true);
      const q = tries[1].query;
      assert.equal(q.singleEvents, 'true'); assert.equal(q.orderBy, 'startTime'); assert.equal(q.maxResults, '20');
      const span = Date.parse(q.timeMax) - Date.parse(q.timeMin);
      assert.equal(span, 7 * 24 * 3600 * 1000); assert.ok(Math.abs(Date.parse(q.timeMin) - Date.now()) < 60000);
      ok(await call('calendar_list_events', { timeMin: '2026-11-18T00:00:00+10:00', timeMax: '2026-11-19T00:00:00+10:00', query: 'standup' }));
      assert.equal(bridgeCalls.stale - before.stale, 1, 'the refreshed token is kept'); assert.equal(bridgeCalls.fresh - before.fresh, 1);
      assert.equal(lastSeen((r) => r.path.endsWith('/events')).query.q, 'standup');

      const created = ok(await call('calendar_create_event', { summary: 'Review', start: '2026-11-18T10:00:00+10:00', end: '2026-11-18T10:30:00+10:00', attendees: ['ana@example.test'], location: 'Room 2' }));
      const post = lastSeen((r) => r.method === 'POST');
      assert.equal(post.query.sendUpdates, 'none', 'guests are not emailed by default');
      assert.deepEqual(post.body, { summary: 'Review', start: { dateTime: '2026-11-18T10:00:00+10:00' }, end: { dateTime: '2026-11-18T10:30:00+10:00' }, location: 'Room 2', attendees: [{ email: 'ana@example.test' }] });
      assert.equal(created.structuredContent.id, 'e9'); assert.match(textOf(created), /were not emailed/);
      ok(await call('calendar_create_event', { calendarId: 'team@group.calendar.google.com', summary: 'Offsite', start: '2026-11-20', end: '2026-11-20', notifyAttendees: true }));
      const allDay = lastSeen((r) => r.method === 'POST');
      assert.equal(allDay.path, '/calendar/v3/calendars/team%40group.calendar.google.com/events'); assert.equal(allDay.query.sendUpdates, 'all');
      assert.deepEqual([allDay.body.start, allDay.body.end], [{ date: '2026-11-20' }, { date: '2026-11-21' }]);
      err(await call('calendar_create_event', { summary: 'x', start: '2026-11-18T10:00:00', end: '2026-11-18T11:00:00' }), /no UTC offset/);
      ok(await call('calendar_create_event', { summary: 'x', start: '2026-11-18T10:00:00', end: '2026-11-18T11:00:00', timeZone: 'Australia/Sydney' }));
      assert.equal(lastSeen((r) => r.method === 'POST').body.start.timeZone, 'Australia/Sydney');
      err(await call('calendar_create_event', { summary: 'x', start: '2026-11-18T11:00:00Z', end: '2026-11-18T10:00:00Z' }), /end must be after start/);
      err(await call('calendar_list_events', { timeMin: 'tomorrow' }), /ISO 8601/);
    });
  }

  // --- bridge failures: its sentence passes through; off-loopback addresses are refused ---
  await session('gmail', 'newline', { ...env, AUTOHAND_SQUAD_CONNECTOR_ID: 'gw-broken' }, async ({ call }) => {
    err(await call('gmail_search', { query: 'x' }), /^Sign in to Google again in Settings › Connectors\.$/);
  });
  await session('gmail', 'newline', { ...env, AUTOHAND_SQUAD_CONNECTOR_TOKEN: 'wrong' }, async ({ call }) => {
    err(await call('gmail_search', { query: 'x' }), /did not recognise this connector session/);
  });
  const refusedBefore = bridgeCalls.refused + bridgeCalls.fresh;
  for (const url of ['http://example.com/api/connectors/runtime', `https://127.0.0.1:${bridgePort}/api/connectors/runtime`, 'http://10.0.0.5:4545/api/connectors/runtime', 'not a url']) {
    await session('drive', 'header', { ...env, AUTOHAND_SQUAD_CONNECTOR_URL: url }, async ({ call }) => {
      err(await call('drive_recent', {}), /not a local http address/);
    });
  }
  assert.equal(bridgeCalls.refused + bridgeCalls.fresh, refusedBefore, 'nothing was sent for a refused address');
  await session('calendar', 'newline', { ...env, AUTOHAND_SQUAD_CONNECTOR_ID: '' }, async ({ call }) => {
    err(await call('calendar_list_events', {}), /isn't connected/);
  });

  // --- the token and the connector token never appear in any tool output ---
  for (const output of outputs) for (const secret of [...TOKENS, CONNECTOR_TOKEN, 'grant-should-vanish']) assert.ok(!output.includes(secret), `a tool output leaked ${secret}: ${output.slice(0, 200)}`);
  assert.ok(seen.every((r) => r.auth === '' || /^Bearer tok-[12]$/.test(r.auth)));
  passed = outputs.length;
} finally {
  for (const child of children) child.kill();
  bridge.close(); google.close();
}
console.log(`check-google-workspace-mcp passed: ${passed} tool calls across gmail, drive and calendar in both framings (${bridgeCalls.fresh} fresh and ${bridgeCalls.stale} stale token requests, ${seen.length} fake Google requests).`);
