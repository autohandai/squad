# Observability

Autohand Squad writes its structured logs in the OpenTelemetry Logs Data Model
and can export them over OTLP/HTTP. No SDK dependency is involved: the bridge
and the Rust runtime emit OTLP/JSON directly, so the files are readable by the
OpenTelemetry Collector's `otlpjsonfile` receiver and any backend that accepts
OTLP/JSON.

## Files

| File | Writer | Contents |
| --- | --- | --- |
| `~/.autohand/squad/logs/daemon.otlp.jsonl` | daemon (`autohand-squad-daemon`) | queue and run lifecycle, background job failures |
| `~/.autohand/squad/logs/tray.otlp.jsonl` | desktop launcher (`autohand-squad-ui`) | launch failures with the preflight detail |
| `<app state>/logs/web.otlp.jsonl` | web bridge (`server.mjs`) | startup, failed API requests, telemetry event mirrors |
| `<app state>/run-logs/<run id>.otlp.jsonl` | web bridge | every stdout / stderr / system line of a tracked run |

`<app state>` is `.autohand` inside the checkout during development and the
app state directory of an installed build. `AUTOHAND_SQUAD_LOGS_DIR` moves the
bridge's `logs/` directory.

Each line is one `ResourceLogs` envelope holding one `LogRecord`:

```json
{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"autohand-squad-web"}}]},
 "scopeLogs":[{"scope":{"name":"autohand.squad.web","version":"0.1.5"},
 "logRecords":[{"timeUnixNano":"1789948800000000000","observedTimeUnixNano":"1789948800000000000",
 "severityNumber":9,"severityText":"INFO","body":{"stringValue":"started autohand --path …"},
 "attributes":[{"key":"log.source","value":{"stringValue":"system"}},{"key":"autohand.run.id","value":{"stringValue":"run_x"}}],
 "traceId":"…32 hex…","spanId":"…16 hex…","droppedAttributesCount":0}]}]}]}
```

Run records use the run id as the trace id, so every line of a run correlates
in a backend without extra joins.

The plain-text captures stay as they were: `server.log`, `tray.log`,
`web-server.log` are raw child-process output for `Open Logs` and the
`/logs` endpoint. `telemetry.jsonl` keeps its analytics event contract; each
event is additionally mirrored as a log record with an `event.name` attribute.

### Attributes

| Attribute | Where | Meaning |
| --- | --- | --- |
| `log.source` | run logs | `stdout`, `stderr`, or `system` |
| `autohand.run.id` | run logs, daemon | run identifier (also the trace id) |
| `autohand.run.kind`, `autohand.harness`, `autohand.member.id`, `autohand.workspace` | run logs | what ran, on which engine, for whom, where |
| `event.name` | web | telemetry event mirrored as a log |
| `http.request.method`, `url.path`, `http.response.status_code`, `error.type` | web | failed API requests |
| `autohand.launch.detail` | launcher | preflight or bootstrap failure body |

Severity: stdout and system lines are `INFO`; stderr lines are `WARN`, or
`ERROR` when they mention an error, failure, panic, or fatal condition; daemon
messages that contain "failed" or "error" are `ERROR`; launcher failures are
`FATAL`.

## Export

Set the standard OpenTelemetry variables in the environment of the app (or of
`bun run dev`):

| Variable | Effect |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | base URL of an OTLP/HTTP receiver; `/v1/logs` is appended |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | full logs URL, takes precedence |
| `OTEL_EXPORTER_OTLP_HEADERS` / `OTEL_EXPORTER_OTLP_LOGS_HEADERS` | `key=value,key=value` request headers (API keys, tenants) |
| `OTEL_EXPORTER_OTLP_TIMEOUT` | request timeout in milliseconds (default 10000) |
| `OTEL_SERVICE_NAME` | overrides `service.name` |
| `OTEL_RESOURCE_ATTRIBUTES` | extra resource attributes, `key=value,key=value` |
| `OTEL_LOG_LEVEL` | minimum severity written and exported (default `INFO`) |

Records are batched (two seconds or 200 records) and posted as OTLP/JSON. A
failed export is retried on the next flush up to three times and then dropped
so memory stays bounded; the bridge reports `exportFailures` and
`lastExportError` under `observability` in `GET /api/runtime`.

To tail the files instead of exporting, point a Collector at them:

```yaml
receivers:
  otlpjsonfile:
    include:
      - ~/.autohand/squad/logs/*.otlp.jsonl
      - ~/.autohand/squad/app/run-logs/*.otlp.jsonl
```

## Checks

```bash
bun run check:otel      # envelope shape, file round trip, loopback OTLP/HTTP export
cd daemon && cargo test otel
```
