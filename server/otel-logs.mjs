// OpenTelemetry log records for the Squad bridge.
//
// Every log line the bridge writes is an OTLP/JSON `ResourceLogs` envelope
// holding one `LogRecord` (the OpenTelemetry Logs Data Model), one JSON object
// per line. That is exactly what the OpenTelemetry Collector's `otlpjsonfile`
// receiver consumes, so the files can be tailed into any backend without a
// custom parser. When OTEL_EXPORTER_OTLP_ENDPOINT (or the logs-specific
// variable) is set, the same records are batched and POSTed with OTLP/HTTP.
//
// Environment (standard OpenTelemetry names):
//   OTEL_SERVICE_NAME                    resource service.name (default autohand-squad-web)
//   OTEL_RESOURCE_ATTRIBUTES             key=value,key=value merged into the resource
//   OTEL_EXPORTER_OTLP_ENDPOINT          base URL; /v1/logs is appended
//   OTEL_EXPORTER_OTLP_LOGS_ENDPOINT     full logs URL (takes precedence)
//   OTEL_EXPORTER_OTLP_HEADERS           key=value,key=value request headers
//   OTEL_EXPORTER_OTLP_LOGS_HEADERS      logs-specific headers (merged, takes precedence)
//   OTEL_EXPORTER_OTLP_TIMEOUT           export timeout in ms (default 10000)
//   OTEL_LOG_LEVEL                       minimum severity to write/export (default INFO)

import { randomBytes } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";

export const SEVERITY = Object.freeze({
  TRACE: 1,
  DEBUG: 5,
  INFO: 9,
  WARN: 13,
  ERROR: 17,
  FATAL: 21,
});

const SEVERITY_TEXT = new Map([
  [1, "TRACE"],
  [5, "DEBUG"],
  [9, "INFO"],
  [13, "WARN"],
  [17, "ERROR"],
  [21, "FATAL"],
]);

export function severityFromText(text, fallback = SEVERITY.INFO) {
  const upper = String(text || "").trim().toUpperCase();
  for (const [number, name] of SEVERITY_TEXT) {
    if (name === upper) return number;
  }
  if (upper === "WARNING") return SEVERITY.WARN;
  if (upper === "ERR") return SEVERITY.ERROR;
  return fallback;
}

export function severityText(number) {
  const known = SEVERITY_TEXT.get(number);
  if (known) return known;
  if (number >= 21) return "FATAL";
  if (number >= 17) return "ERROR";
  if (number >= 13) return "WARN";
  if (number >= 9) return "INFO";
  if (number >= 5) return "DEBUG";
  return "TRACE";
}

function parseKeyValueList(value) {
  const entries = {};
  for (const pair of String(value || "").split(",")) {
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    const key = pair.slice(0, index).trim();
    const raw = pair.slice(index + 1).trim();
    if (!key) continue;
    try {
      entries[key] = decodeURIComponent(raw);
    } catch {
      entries[key] = raw;
    }
  }
  return entries;
}

/** Encode a JS value as an OTLP AnyValue. */
export function anyValue(value) {
  if (value === null || value === undefined) return { stringValue: "" };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === "bigint") return { intValue: value.toString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(anyValue) } };
  if (typeof value === "object") {
    return { kvlistValue: { values: Object.entries(value).map(([key, item]) => ({ key, value: anyValue(item) })) } };
  }
  return { stringValue: String(value) };
}

/** Decode an OTLP AnyValue back into a JS value. */
export function fromAnyValue(value) {
  if (!value || typeof value !== "object") return value;
  if ("stringValue" in value) return value.stringValue;
  if ("boolValue" in value) return value.boolValue;
  if ("intValue" in value) {
    const parsed = Number(value.intValue);
    return Number.isSafeInteger(parsed) ? parsed : value.intValue;
  }
  if ("doubleValue" in value) return value.doubleValue;
  if ("arrayValue" in value) return (value.arrayValue?.values || []).map(fromAnyValue);
  if ("kvlistValue" in value) {
    return Object.fromEntries((value.kvlistValue?.values || []).map((entry) => [entry.key, fromAnyValue(entry.value)]));
  }
  return undefined;
}

export function attributesFromObject(attributes = {}) {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => ({ key, value: anyValue(value) }));
}

export function attributesToObject(attributes = []) {
  return Object.fromEntries((Array.isArray(attributes) ? attributes : []).map((entry) => [entry.key, fromAnyValue(entry.value)]));
}

function nowNano(date = Date.now()) {
  return `${BigInt(Math.floor(date)) * 1_000_000n + (process.hrtime.bigint() % 1_000_000n)}`;
}

/** Deterministic 32-hex trace id for a run or session id so records correlate. */
export function traceIdFor(seed) {
  const text = String(seed || "");
  if (!text) return randomBytes(16).toString("hex");
  const hex = text.replace(/[^0-9a-f]/gi, "").toLowerCase();
  if (hex.length >= 32) return hex.slice(0, 32);
  let hash = 0xcbf29ce484222325n;
  for (const char of text) {
    hash ^= BigInt(char.codePointAt(0));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  const first = hash.toString(16).padStart(16, "0");
  let second = 0x84222325cbf29ce4n;
  for (const char of [...text].reverse()) {
    second ^= BigInt(char.codePointAt(0));
    second = (second * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `${first}${second.toString(16).padStart(16, "0")}`.slice(0, 32);
}

export function spanIdFor(seed) {
  return traceIdFor(`span:${seed || randomBytes(8).toString("hex")}`).slice(0, 16);
}

/**
 * Build a single OTLP/JSON ResourceLogs envelope holding one LogRecord.
 * `body` may be a string or a structured object (encoded as kvlist).
 */
export function buildLogEnvelope({
  body,
  severityNumber = SEVERITY.INFO,
  attributes = {},
  resource,
  scope,
  timestamp = Date.now(),
  traceId = "",
  spanId = "",
} = {}) {
  const record = {
    timeUnixNano: nowNano(timestamp),
    observedTimeUnixNano: nowNano(Date.now()),
    severityNumber,
    severityText: severityText(severityNumber),
    body: anyValue(body),
    attributes: attributesFromObject(attributes),
    droppedAttributesCount: 0,
  };
  if (traceId) record.traceId = traceId;
  if (spanId) record.spanId = spanId;
  return {
    resourceLogs: [
      {
        resource: { attributes: attributesFromObject(resource || {}) },
        scopeLogs: [
          {
            scope: { name: scope?.name || "autohand.squad", version: scope?.version || "" },
            logRecords: [record],
          },
        ],
      },
    ],
  };
}

/** Flatten one OTLP/JSON line (or envelope) into readable records. */
export function parseLogEnvelope(input) {
  let envelope = input;
  if (typeof input === "string") {
    try {
      envelope = JSON.parse(input);
    } catch {
      return [];
    }
  }
  const output = [];
  for (const resourceLogs of envelope?.resourceLogs || []) {
    const resource = attributesToObject(resourceLogs?.resource?.attributes);
    for (const scopeLogs of resourceLogs?.scopeLogs || []) {
      for (const record of scopeLogs?.logRecords || []) {
        const nano = BigInt(record.timeUnixNano || record.observedTimeUnixNano || 0);
        output.push({
          timestamp: new Date(Number(nano / 1_000_000n)).toISOString(),
          severityNumber: Number(record.severityNumber) || SEVERITY.INFO,
          severityText: record.severityText || severityText(Number(record.severityNumber) || SEVERITY.INFO),
          body: fromAnyValue(record.body),
          attributes: attributesToObject(record.attributes),
          resource,
          scope: scopeLogs?.scope?.name || "",
          traceId: record.traceId || "",
          spanId: record.spanId || "",
        });
      }
    }
  }
  return output;
}

export function exporterConfigFromEnv(env = process.env) {
  const logsEndpoint = String(env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT || "").trim();
  const baseEndpoint = String(env.OTEL_EXPORTER_OTLP_ENDPOINT || "").trim();
  const endpoint = logsEndpoint || (baseEndpoint ? `${baseEndpoint.replace(/\/+$/, "")}/v1/logs` : "");
  const headers = {
    ...parseKeyValueList(env.OTEL_EXPORTER_OTLP_HEADERS),
    ...parseKeyValueList(env.OTEL_EXPORTER_OTLP_LOGS_HEADERS),
  };
  const timeoutMs = Number(env.OTEL_EXPORTER_OTLP_TIMEOUT) > 0 ? Number(env.OTEL_EXPORTER_OTLP_TIMEOUT) : 10000;
  return { endpoint, headers, timeoutMs };
}

export function resourceFromEnv({ serviceName, serviceVersion, instanceId, extra = {}, env = process.env } = {}) {
  return {
    "service.name": String(env.OTEL_SERVICE_NAME || serviceName || "autohand-squad-web"),
    "service.version": serviceVersion || "",
    "service.instance.id": instanceId || "",
    "host.name": extra["host.name"] || "",
    "os.type": process.platform,
    "process.pid": process.pid,
    ...extra,
    ...parseKeyValueList(env.OTEL_RESOURCE_ATTRIBUTES),
  };
}

/**
 * A logger that appends OTLP/JSON lines to a file and, when configured,
 * exports batches over OTLP/HTTP. File writes are serialized per path so
 * concurrent chunks never interleave; export failures are retried on the
 * next flush and never block the caller.
 */
export class OtelLogger {
  constructor({ resource, scope, minimumSeverity, exporter, flushIntervalMs = 2000, maxBatch = 200 } = {}) {
    this.resource = resource || resourceFromEnv();
    this.scope = scope || { name: "autohand.squad", version: this.resource["service.version"] || "" };
    this.minimumSeverity = minimumSeverity ?? severityFromText(process.env.OTEL_LOG_LEVEL, SEVERITY.INFO);
    this.exporter = exporter || exporterConfigFromEnv();
    this.flushIntervalMs = flushIntervalMs;
    this.maxBatch = maxBatch;
    this.pending = [];
    this.writeChains = new Map();
    this.timer = null;
    this.exportFailures = 0;
    this.lastExportError = "";
  }

  get exportEnabled() {
    return Boolean(this.exporter?.endpoint);
  }

  record({ file, body, severityNumber = SEVERITY.INFO, attributes = {}, timestamp, traceId, spanId, scope }) {
    if (severityNumber < this.minimumSeverity) return null;
    const envelope = buildLogEnvelope({
      body,
      severityNumber,
      attributes,
      resource: this.resource,
      scope: scope || this.scope,
      timestamp,
      traceId,
      spanId,
    });
    if (file) this.appendLine(file, `${JSON.stringify(envelope)}\n`);
    if (this.exportEnabled) {
      this.pending.push(envelope.resourceLogs[0].scopeLogs[0].logRecords[0]);
      if (this.pending.length >= this.maxBatch) void this.flush();
      else this.schedule();
    }
    return envelope;
  }

  appendLine(file, line) {
    const previous = this.writeChains.get(file) || Promise.resolve();
    const next = previous
      .then(() => mkdir(dirname(file), { recursive: true }))
      .then(() => appendFile(file, line, "utf8"))
      .catch(() => {});
    this.writeChains.set(file, next);
    return next;
  }

  schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.flushIntervalMs);
    this.timer.unref?.();
  }

  async flush() {
    if (!this.exportEnabled || !this.pending.length) return;
    const batch = this.pending.splice(0, this.maxBatch);
    const payload = {
      resourceLogs: [
        {
          resource: { attributes: attributesFromObject(this.resource) },
          scopeLogs: [{ scope: this.scope, logRecords: batch }],
        },
      ],
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.exporter.timeoutMs);
    try {
      const response = await fetch(this.exporter.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.exporter.headers },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`OTLP logs export failed: ${response.status} ${response.statusText}`);
      this.exportFailures = 0;
      this.lastExportError = "";
    } catch (error) {
      this.exportFailures += 1;
      this.lastExportError = error?.message || String(error);
      // Keep the batch for one retry; drop after repeated failures so memory stays bounded.
      if (this.exportFailures <= 3) this.pending.unshift(...batch);
    } finally {
      clearTimeout(timer);
    }
    if (this.pending.length) this.schedule();
  }

  async close() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
    await Promise.all(Array.from(this.writeChains.values()));
  }
}
