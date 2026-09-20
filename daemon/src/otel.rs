//! OpenTelemetry log records for the Squad runtime.
//!
//! Each structured log line is an OTLP/JSON `ResourceLogs` envelope holding a
//! single `LogRecord` (the OpenTelemetry Logs Data Model), one JSON object per
//! line, which is what the Collector's `otlpjsonfile` receiver reads. When the
//! standard `OTEL_EXPORTER_OTLP_ENDPOINT` (or `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`)
//! variable is set, records are also batched and posted over OTLP/HTTP from a
//! background thread so the event loop and the daemon never block on export.

use crate::state::StatePaths;
use crate::VERSION;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Severity {
    Trace = 1,
    Debug = 5,
    Info = 9,
    Warn = 13,
    Error = 17,
    Fatal = 21,
}

impl Severity {
    pub fn text(self) -> &'static str {
        match self {
            Severity::Trace => "TRACE",
            Severity::Debug => "DEBUG",
            Severity::Info => "INFO",
            Severity::Warn => "WARN",
            Severity::Error => "ERROR",
            Severity::Fatal => "FATAL",
        }
    }

    fn from_env(value: &str) -> Option<Self> {
        match value.trim().to_ascii_uppercase().as_str() {
            "TRACE" => Some(Severity::Trace),
            "DEBUG" => Some(Severity::Debug),
            "INFO" => Some(Severity::Info),
            "WARN" | "WARNING" => Some(Severity::Warn),
            "ERROR" | "ERR" => Some(Severity::Error),
            "FATAL" => Some(Severity::Fatal),
            _ => None,
        }
    }
}

fn any_value(value: &Value) -> Value {
    match value {
        Value::Null => json!({ "stringValue": "" }),
        Value::Bool(flag) => json!({ "boolValue": flag }),
        Value::Number(number) => {
            if number.is_i64() || number.is_u64() {
                json!({ "intValue": number.to_string() })
            } else {
                json!({ "doubleValue": number })
            }
        }
        Value::String(text) => json!({ "stringValue": text }),
        Value::Array(items) => {
            json!({ "arrayValue": { "values": items.iter().map(any_value).collect::<Vec<_>>() } })
        }
        Value::Object(map) => json!({
            "kvlistValue": {
                "values": map.iter().map(|(key, item)| json!({ "key": key, "value": any_value(item) })).collect::<Vec<_>>()
            }
        }),
    }
}

fn attributes(map: &[(&str, Value)]) -> Vec<Value> {
    map.iter()
        .filter(|(_, value)| !matches!(value, Value::Null) && value.as_str() != Some(""))
        .map(|(key, value)| json!({ "key": key, "value": any_value(value) }))
        .collect()
}

fn parse_key_values(raw: &str) -> Vec<(String, String)> {
    raw.split(',')
        .filter_map(|pair| {
            let (key, value) = pair.split_once('=')?;
            let key = key.trim();
            if key.is_empty() {
                return None;
            }
            Some((key.to_string(), value.trim().to_string()))
        })
        .collect()
}

fn now_unix_nano() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    nanos.to_string()
}

fn min_severity() -> Severity {
    std::env::var("OTEL_LOG_LEVEL")
        .ok()
        .and_then(|value| Severity::from_env(&value))
        .unwrap_or(Severity::Info)
}

/// Resource attributes shared by every record of one process.
pub fn resource(service_name: &str) -> Vec<Value> {
    let name = std::env::var("OTEL_SERVICE_NAME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| service_name.to_string());
    let mut pairs: Vec<(&str, Value)> = vec![
        ("service.name", Value::String(name)),
        ("service.version", Value::String(VERSION.to_string())),
        (
            "service.instance.id",
            Value::String(format!("{}-{}", host_name(), std::process::id())),
        ),
        ("host.name", Value::String(host_name())),
        ("os.type", Value::String(std::env::consts::OS.to_string())),
        ("process.pid", json!(std::process::id())),
    ];
    let extra = std::env::var("OTEL_RESOURCE_ATTRIBUTES").unwrap_or_default();
    let extra_pairs = parse_key_values(&extra);
    let mut owned: Vec<(String, Value)> = Vec::new();
    for (key, value) in extra_pairs {
        owned.push((key, Value::String(value)));
    }
    let owned_refs: Vec<(&str, Value)> = owned
        .iter()
        .map(|(key, value)| (key.as_str(), value.clone()))
        .collect();
    pairs.extend(owned_refs);
    attributes(&pairs)
}

fn host_name() -> String {
    std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "localhost".to_string())
}

/// Build one OTLP/JSON envelope holding a single log record.
pub fn envelope(
    service_name: &str,
    scope: &str,
    severity: Severity,
    body: &str,
    attrs: &[(&str, Value)],
) -> Value {
    json!({
        "resourceLogs": [{
            "resource": { "attributes": resource(service_name) },
            "scopeLogs": [{
                "scope": { "name": scope, "version": VERSION },
                "logRecords": [log_record(severity, body, attrs)]
            }]
        }]
    })
}

fn log_record(severity: Severity, body: &str, attrs: &[(&str, Value)]) -> Value {
    let now = now_unix_nano();
    json!({
        "timeUnixNano": now,
        "observedTimeUnixNano": now,
        "severityNumber": severity as u8,
        "severityText": severity.text(),
        "body": { "stringValue": body },
        "attributes": attributes(attrs),
        "droppedAttributesCount": 0
    })
}

/// Append one record to `file` and queue it for export. Never fails loudly:
/// logging must not take the runtime down.
pub fn emit(
    file: &Path,
    service_name: &str,
    scope: &str,
    severity: Severity,
    body: &str,
    attrs: &[(&str, Value)],
) {
    if severity < min_severity() {
        return;
    }
    let record = envelope(service_name, scope, severity, body, attrs);
    if let Some(parent) = file.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut handle) = fs::OpenOptions::new().create(true).append(true).open(file) {
        if let Ok(line) = serde_json::to_string(&record) {
            let _ = writeln!(handle, "{line}");
        }
    }
    exporter().queue(service_name, scope, log_record(severity, body, attrs));
}

/// Convenience for the daemon's structured log.
pub fn daemon_log(paths: &StatePaths, severity: Severity, body: &str, attrs: &[(&str, Value)]) {
    emit(
        &paths.daemon_otel_log,
        "autohand-squad-daemon",
        "autohand.squad.daemon",
        severity,
        body,
        attrs,
    );
}

/// Convenience for the desktop launcher / tray structured log.
pub fn launcher_log(paths: &StatePaths, severity: Severity, body: &str, attrs: &[(&str, Value)]) {
    emit(
        &paths.tray_otel_log,
        "autohand-squad-launcher",
        "autohand.squad.launcher",
        severity,
        body,
        attrs,
    );
}

/// Read the records of an OTLP/JSON lines file, newest last, flattened to
/// (timestamp ms, severity number, body, attributes).
pub fn read_records(file: &Path, limit: usize) -> Vec<FlatRecord> {
    let content = fs::read_to_string(file).unwrap_or_default();
    let mut records: Vec<FlatRecord> = content
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .flat_map(flatten)
        .collect();
    if records.len() > limit {
        records.drain(0..records.len() - limit);
    }
    records
}

#[derive(Debug, Clone, PartialEq)]
pub struct FlatRecord {
    pub time_ms: u128,
    pub severity: u8,
    pub severity_text: String,
    pub body: String,
    pub attributes: HashMap<String, Value>,
}

fn flatten(envelope: Value) -> Vec<FlatRecord> {
    let mut output = Vec::new();
    let Some(resource_logs) = envelope.get("resourceLogs").and_then(Value::as_array) else {
        return output;
    };
    for resource in resource_logs {
        let Some(scopes) = resource.get("scopeLogs").and_then(Value::as_array) else {
            continue;
        };
        for scope in scopes {
            let Some(records) = scope.get("logRecords").and_then(Value::as_array) else {
                continue;
            };
            for record in records {
                let nanos: u128 = record
                    .get("timeUnixNano")
                    .and_then(Value::as_str)
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(0);
                let severity = record
                    .get("severityNumber")
                    .and_then(Value::as_u64)
                    .unwrap_or(Severity::Info as u64) as u8;
                let body = record
                    .get("body")
                    .and_then(|body| body.get("stringValue"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let mut attributes = HashMap::new();
                if let Some(list) = record.get("attributes").and_then(Value::as_array) {
                    for entry in list {
                        if let (Some(key), Some(value)) =
                            (entry.get("key").and_then(Value::as_str), entry.get("value"))
                        {
                            attributes.insert(key.to_string(), plain_value(value));
                        }
                    }
                }
                output.push(FlatRecord {
                    time_ms: nanos / 1_000_000,
                    severity,
                    severity_text: record
                        .get("severityText")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    body,
                    attributes,
                });
            }
        }
    }
    output
}

fn plain_value(value: &Value) -> Value {
    if let Some(text) = value.get("stringValue") {
        return text.clone();
    }
    if let Some(flag) = value.get("boolValue") {
        return flag.clone();
    }
    if let Some(int) = value.get("intValue").and_then(Value::as_str) {
        return int
            .parse::<i64>()
            .map(Value::from)
            .unwrap_or(Value::String(int.to_string()));
    }
    if let Some(double) = value.get("doubleValue") {
        return double.clone();
    }
    value.clone()
}

struct ExporterConfig {
    endpoint: String,
    headers: Vec<(String, String)>,
    timeout: Duration,
}

impl ExporterConfig {
    fn from_env() -> Option<Self> {
        let logs = std::env::var("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT").unwrap_or_default();
        let base = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT").unwrap_or_default();
        let endpoint = if !logs.trim().is_empty() {
            logs.trim().to_string()
        } else if !base.trim().is_empty() {
            format!("{}/v1/logs", base.trim().trim_end_matches('/'))
        } else {
            return None;
        };
        let mut headers =
            parse_key_values(&std::env::var("OTEL_EXPORTER_OTLP_HEADERS").unwrap_or_default());
        headers.extend(parse_key_values(
            &std::env::var("OTEL_EXPORTER_OTLP_LOGS_HEADERS").unwrap_or_default(),
        ));
        let timeout = std::env::var("OTEL_EXPORTER_OTLP_TIMEOUT")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| *value > 0)
            .map(Duration::from_millis)
            .unwrap_or(Duration::from_secs(10));
        Some(Self {
            endpoint,
            headers,
            timeout,
        })
    }
}

struct Exporter {
    config: Option<ExporterConfig>,
    pending: Mutex<Vec<(String, String, Value)>>,
}

impl Exporter {
    fn queue(&self, service_name: &str, scope: &str, record: Value) {
        let Some(config) = &self.config else {
            return;
        };
        let mut pending = match self.pending.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        pending.push((service_name.to_string(), scope.to_string(), record));
        if pending.len() > 500 {
            let overflow = pending.len() - 500;
            pending.drain(0..overflow);
        }
        if pending.len() == 1 {
            let endpoint = config.endpoint.clone();
            let headers = config.headers.clone();
            let timeout = config.timeout;
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(2));
                exporter().flush(&endpoint, &headers, timeout);
            });
        }
    }

    fn flush(&self, endpoint: &str, headers: &[(String, String)], timeout: Duration) {
        let batch: Vec<(String, String, Value)> = {
            let mut pending = match self.pending.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            std::mem::take(&mut *pending)
        };
        if batch.is_empty() {
            return;
        }
        // Group by service so each ResourceLogs carries the right resource.
        let mut by_service: HashMap<String, (String, Vec<Value>)> = HashMap::new();
        for (service, scope, record) in batch {
            by_service
                .entry(service)
                .or_insert_with(|| (scope, Vec::new()))
                .1
                .push(record);
        }
        let resource_logs: Vec<Value> = by_service
            .into_iter()
            .map(|(service, (scope, records))| {
                json!({
                    "resource": { "attributes": resource(&service) },
                    "scopeLogs": [{ "scope": { "name": scope, "version": VERSION }, "logRecords": records }]
                })
            })
            .collect();
        let payload = json!({ "resourceLogs": resource_logs });
        let client = match reqwest::blocking::Client::builder()
            .timeout(timeout)
            .build()
        {
            Ok(client) => client,
            Err(_) => return,
        };
        let mut request = client.post(endpoint).json(&payload);
        for (key, value) in headers {
            request = request.header(key.as_str(), value.as_str());
        }
        // Best effort: a failed export is dropped rather than retried forever.
        let _ = request.send();
    }
}

fn exporter() -> &'static Exporter {
    static EXPORTER: OnceLock<Exporter> = OnceLock::new();
    EXPORTER.get_or_init(|| Exporter {
        config: ExporterConfig::from_env(),
        pending: Mutex::new(Vec::new()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_file(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("squad-otel-{}-{nonce}-{name}", std::process::id()))
    }

    #[test]
    fn envelope_matches_otlp_json_shape() {
        let record = envelope(
            "svc",
            "scope",
            Severity::Error,
            "queue write failed",
            &[("autohand.run.id", json!("run_1"))],
        );
        let log = &record["resourceLogs"][0]["scopeLogs"][0]["logRecords"][0];
        assert_eq!(log["severityNumber"], 17);
        assert_eq!(log["severityText"], "ERROR");
        assert_eq!(log["body"]["stringValue"], "queue write failed");
        assert_eq!(log["attributes"][0]["key"], "autohand.run.id");
        assert_eq!(log["attributes"][0]["value"]["stringValue"], "run_1");
        assert!(log["timeUnixNano"]
            .as_str()
            .unwrap()
            .parse::<u128>()
            .is_ok());
        let resource = &record["resourceLogs"][0]["resource"]["attributes"];
        assert!(resource
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["key"] == "service.name" && entry["value"]["stringValue"] == "svc"));
    }

    #[test]
    fn emit_appends_one_record_per_line_and_reads_back() {
        let file = temp_file("daemon.otlp.jsonl");
        emit(
            &file,
            "svc",
            "scope",
            Severity::Info,
            "run r1 started",
            &[("autohand.run.id", json!("r1"))],
        );
        emit(
            &file,
            "svc",
            "scope",
            Severity::Error,
            "run r1 failed",
            &[("autohand.run.id", json!("r1"))],
        );
        let lines = fs::read_to_string(&file).unwrap();
        assert_eq!(lines.lines().count(), 2);
        let records = read_records(&file, 10);
        assert_eq!(records.len(), 2);
        assert_eq!(records[1].severity, Severity::Error as u8);
        assert_eq!(records[1].body, "run r1 failed");
        assert_eq!(
            records[1].attributes.get("autohand.run.id"),
            Some(&json!("r1"))
        );
        let _ = fs::remove_file(&file);
    }

    #[test]
    fn severity_parses_common_spellings() {
        assert_eq!(Severity::from_env("warning"), Some(Severity::Warn));
        assert_eq!(Severity::from_env("ERR"), Some(Severity::Error));
        assert_eq!(Severity::from_env("nope"), None);
    }
}
