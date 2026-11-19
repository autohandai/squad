#!/usr/bin/env node
// Agents report bugs and feedback through the Squad MCP (ADR-0258). Drives a
// real bridge whose feedback API is a local stand-in: the report is labelled
// with who sent it, carries no screenshot and no email, the same text is sent
// once an hour, and a sixth report in an hour is refused.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startBridge } from './lib/reliability-browser.mjs';

const received = [];
const stub = createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => { received.push({ path: req.url, body: JSON.parse(body || '{}') }); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: true, id: `fb-${received.length}` })); });
});
await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${stub.address().port}`;
const bridge = await startBridge({ prepare: async () => ({ AUTOHAND_SQUAD_API_BASE_URL: origin }) });
try {
  const send = body => bridge.api('/api/feedback/agent', 'POST', body);
  const first = await send({ kind: 'bug', summary: 'squad_create_member refused valid instructions', detail: 'Error: longer than 1200 characters', reporter: 'Chief of Staff' });
  assert.equal(first.success, true, JSON.stringify(first));
  assert.equal(first.data.sent, true);
  const sent = received.at(-1);
  assert.match(sent.path, /\/v1\/feedback\/squad$/);
  assert.match(sent.body.description, /^\[Bug reported by Chief of Staff through the Squad MCP\]/);
  assert.equal(sent.body.screenshot, null, 'no screenshot');
  assert.equal(sent.body.userEmail, '', 'no email');
  assert.equal(sent.body.allowContact, false);

  const again = await send({ kind: 'bug', summary: 'squad_create_member refused valid instructions', detail: 'Error: longer than 1200 characters', reporter: 'Chief of Staff' });
  assert.equal(again.data.duplicate, true, 'the same report is not sent twice in an hour');
  assert.equal(received.length, 1);

  assert.equal((await send({ kind: 'bug', summary: 'short' })).status, 400, 'a summary says what happened');
  for (let i = 2; i <= 5; i += 1) assert.equal((await send({ kind: 'feedback', summary: `Feedback number ${i} about Squad` })).data.sent, true);
  const sixth = await send({ kind: 'bug', summary: 'One report too many this hour' });
  assert.equal(sixth.status, 429, 'at most five an hour');
  assert.match(sixth.error, /Tell the person instead/);
  assert.equal(received.length, 5);
  console.log('check-agent-feedback: ok (labelled with the reporter, no screenshot or email, duplicates dropped for an hour, five an hour)');
} finally {
  await bridge.close();
  stub.close();
}
