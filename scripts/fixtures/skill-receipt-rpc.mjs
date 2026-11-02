#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';

const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const notify = (method, params) => send({ jsonrpc: '2.0', method, params });
const receipt = JSON.parse(readFileSync(process.env.SQUAD_RECEIPT_FIXTURE_PATH, 'utf8'));
const mode = process.env.SQUAD_RECEIPT_FIXTURE_MODE || 'native';
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.method !== 'autohand.prompt') { send({ jsonrpc: '2.0', id: request.id, result: { success: true } }); return; }
  if (mode === 'rejected') { send({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'Fixture provider rejected request' } }); return; }
  send({ jsonrpc: '2.0', id: request.id, result: { success: true } });
  const timestamp = new Date().toISOString();
  notify('autohand.agentStart', { sessionId: 'fixture-session', model: 'fixture-model', workspace: process.cwd(), timestamp });
  if (mode !== 'text-only') notify('autohand.skillAttachment', { receipt: mode === 'malformed' ? { ...receipt, resources: [{ path: 'SKILL.md', sha256: '0'.repeat(64), bytes: 1 }] } : receipt, timestamp });
  notify('autohand.messageEnd', { messageId: 'fixture-message', content: 'Loaded review. Task succeeded.', timestamp });
  notify('autohand.agentEnd', { sessionId: 'fixture-session', reason: 'completed', timestamp });
});
