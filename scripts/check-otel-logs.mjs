#!/usr/bin/env node
// Deterministic checks for server/otel-logs.mjs: OTLP/JSON envelope shape,
// file append + parse round trip, severity handling, and OTLP/HTTP export
// against a local receiver. No network beyond loopback.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  OtelLogger,
  SEVERITY,
  anyValue,
  buildLogEnvelope,
  exporterConfigFromEnv,
  fromAnyValue,
  parseLogEnvelope,
  severityFromText,
  severityText,
  spanIdFor,
  traceIdFor,
} from '../server/otel-logs.mjs';

// AnyValue encoding round trips every JSON type.
for (const value of ['text', true, 42, 4.5, ['a', 1], { nested: { flag: false } }]) {
  assert.deepEqual(fromAnyValue(anyValue(value)), value, `AnyValue round trip for ${JSON.stringify(value)}`);
}

// Envelope shape follows the OTLP/JSON logs schema.
const envelope = buildLogEnvelope({
  body: 'run started',
  severityNumber: SEVERITY.WARN,
  attributes: { 'autohand.run.id': 'run_1', count: 2, empty: '' },
  resource: { 'service.name': 'test-svc', 'service.version': '1.2.3' },
  scope: { name: 'autohand.test', version: '1' },
  traceId: traceIdFor('run_1'),
  spanId: spanIdFor('run_1'),
  timestamp: Date.parse('2026-09-21T00:00:00.000Z'),
});
const record = envelope.resourceLogs[0].scopeLogs[0].logRecords[0];
assert.equal(record.severityNumber, 13);
assert.equal(record.severityText, 'WARN');
assert.deepEqual(record.body, { stringValue: 'run started' });
assert.equal(record.attributes.length, 2, 'empty attributes are dropped');
assert.equal(record.attributes[1].value.intValue, '2');
assert.match(record.traceId, /^[0-9a-f]{32}$/);
assert.match(record.spanId, /^[0-9a-f]{16}$/);
assert.equal(traceIdFor('run_1'), traceIdFor('run_1'), 'trace ids are deterministic per run');
assert.notEqual(traceIdFor('run_1'), traceIdFor('run_2'));
assert.ok(BigInt(record.timeUnixNano) >= BigInt(Date.parse('2026-09-21T00:00:00.000Z')) * 1_000_000n);
assert.equal(envelope.resourceLogs[0].resource.attributes[0].key, 'service.name');
assert.equal(envelope.resourceLogs[0].scopeLogs[0].scope.name, 'autohand.test');

// Parsing flattens envelopes back into readable records.
const parsed = parseLogEnvelope(JSON.stringify(envelope));
assert.equal(parsed.length, 1);
assert.equal(parsed[0].timestamp, '2026-09-21T00:00:00.000Z');
assert.equal(parsed[0].body, 'run started');
assert.equal(parsed[0].attributes['autohand.run.id'], 'run_1');
assert.equal(parsed[0].resource['service.name'], 'test-svc');
assert.deepEqual(parseLogEnvelope('not json'), []);

// Severity helpers.
assert.equal(severityFromText('warning'), SEVERITY.WARN);
assert.equal(severityFromText('nope', SEVERITY.DEBUG), SEVERITY.DEBUG);
assert.equal(severityText(18), 'ERROR');

// Exporter config from the standard environment variables.
assert.deepEqual(exporterConfigFromEnv({}), { endpoint: '', headers: {}, timeoutMs: 10000 });
assert.equal(exporterConfigFromEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318/' }).endpoint, 'http://collector:4318/v1/logs');
assert.equal(
  exporterConfigFromEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://a', OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'http://b/logs' }).endpoint,
  'http://b/logs',
);
assert.deepEqual(
  exporterConfigFromEnv({ OTEL_EXPORTER_OTLP_HEADERS: 'x-api-key=abc,x-tenant=t%201', OTEL_EXPORTER_OTLP_TIMEOUT: '2500' }).headers,
  { 'x-api-key': 'abc', 'x-tenant': 't 1' },
);

// File append + OTLP/HTTP export against a loopback receiver.
const dir = await mkdtemp(join(tmpdir(), 'squad-otel-check-'));
const received = [];
const receiver = createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    received.push({ headers: req.headers, body: JSON.parse(body) });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
});
await new Promise((resolveListen) => receiver.listen(0, '127.0.0.1', resolveListen));
const port = receiver.address().port;

const logger = new OtelLogger({
  resource: { 'service.name': 'check-svc', 'service.version': '0' },
  scope: { name: 'autohand.check', version: '0' },
  minimumSeverity: SEVERITY.INFO,
  exporter: { endpoint: `http://127.0.0.1:${port}/v1/logs`, headers: { 'x-check': 'yes' }, timeoutMs: 5000 },
  flushIntervalMs: 50,
});
const file = join(dir, 'run.otlp.jsonl');
logger.record({ file, body: 'first', severityNumber: SEVERITY.INFO, attributes: { n: 1 } });
logger.record({ file, body: 'debug is filtered', severityNumber: SEVERITY.DEBUG });
logger.record({ file, body: 'second', severityNumber: SEVERITY.ERROR, attributes: { n: 2 }, traceId: traceIdFor('r') });
await logger.close();
receiver.close();

const lines = (await readFile(file, 'utf8')).trim().split('\n');
assert.equal(lines.length, 2, 'one OTLP envelope per line; DEBUG below the minimum is skipped');
const fileRecords = lines.flatMap((line) => parseLogEnvelope(line));
assert.deepEqual(fileRecords.map((entry) => entry.body), ['first', 'second']);
assert.equal(fileRecords[1].severityText, 'ERROR');
assert.equal(received.length, 1, 'records are batched into one export');
assert.equal(received[0].headers['x-check'], 'yes');
assert.equal(received[0].headers['content-type'], 'application/json');
const exported = received[0].body.resourceLogs[0];
assert.equal(exported.resource.attributes[0].value.stringValue, 'check-svc');
assert.equal(exported.scopeLogs[0].logRecords.length, 2);
assert.equal(exported.scopeLogs[0].logRecords[1].body.stringValue, 'second');

await rm(dir, { recursive: true, force: true });
console.log('OpenTelemetry log checks passed.');
