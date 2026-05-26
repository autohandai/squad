use crate::daemon::read_queue_items;
use crate::state::{
    now_string, read_analytics_record, read_daemon_record, read_install_record,
    read_web_server_record, remove_analytics_record, write_analytics_record, AnalyticsRecord,
    StatePaths, WebServerRecord,
};
use crate::VERSION;
use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::Write;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

pub const DEFAULT_ANALYTICS_PORT: u16 = 19823;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsSnapshot {
    pub success: bool,
    pub generated_at: String,
    pub source: String,
    pub state_dir: String,
    pub services: ServiceMetrics,
    pub versions: VersionMetrics,
    pub work: WorkMetrics,
    pub telemetry: TelemetryMetrics,
    pub timestamps: RuntimeTimestamps,
    pub recent_errors: Vec<RecentError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServiceMetrics {
    pub active_daemons: usize,
    pub main_daemon: Option<ServiceRecord>,
    pub analytics_daemon: Option<ServiceRecord>,
    pub web_server: Option<WebServerRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServiceRecord {
    pub pid: u32,
    pub host: String,
    pub port: u16,
    pub url: String,
    pub running: bool,
    pub started_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VersionMetrics {
    pub runtime_version: String,
    pub installed_version: Option<String>,
    pub installed_channel: Option<String>,
    pub installed_at: Option<String>,
    pub update_channel: Option<String>,
    pub latest_allowed_version: Option<String>,
    pub update_available: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkMetrics {
    pub queue_depth: usize,
    pub queued_jobs: usize,
    pub scheduled_jobs: usize,
    pub active_work: usize,
    pub online_members: usize,
    pub working_agents: usize,
    pub total_runs: usize,
    pub running_runs: usize,
    pub completed_runs: usize,
    pub failed_runs: usize,
    pub rejected_runs: usize,
    pub queue_volume: usize,
    pub failure_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryMetrics {
    pub total_events: usize,
    pub event_counts: BTreeMap<String, usize>,
    pub client_type_counts: BTreeMap<String, usize>,
    pub surface_counts: BTreeMap<String, usize>,
    pub queue_created: usize,
    pub queue_started: usize,
    pub queue_completed: usize,
    pub queue_failed: usize,
    pub errors: usize,
    pub last_event_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTimestamps {
    pub last_device_registration_at: Option<String>,
    pub last_ping_at: Option<String>,
    pub last_feature_flag_check_at: Option<String>,
    pub last_telemetry_flush_at: Option<String>,
    pub last_sync_at: Option<String>,
    pub last_update_check_at: Option<String>,
    pub last_snapshot_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentError {
    pub at: Option<String>,
    pub source: String,
    pub message: String,
    pub run_id: Option<String>,
}

#[derive(Clone)]
struct AnalyticsState {
    paths: StatePaths,
    record: AnalyticsRecord,
    shutdown_tx: Arc<Mutex<Option<oneshot::Sender<()>>>>,
}

#[derive(Debug)]
struct HttpRequest {
    method: String,
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LifecycleResponse {
    success: bool,
    message: String,
}

pub async fn run_analytics_daemon(host: String, port: u16) -> Result<()> {
    let paths = crate::state::default_state_paths();
    run_analytics_daemon_with_paths(paths, host, port).await
}

pub async fn run_analytics_daemon_with_paths(
    paths: StatePaths,
    host: String,
    port: u16,
) -> Result<()> {
    paths.ensure()?;
    let socket: SocketAddr = format!("{host}:{port}")
        .parse()
        .with_context(|| format!("parse analytics address {host}:{port}"))?;
    let listener = TcpListener::bind(socket)
        .await
        .with_context(|| format!("bind analytics daemon {socket}"))?;
    let local_addr = listener.local_addr()?;
    let record = AnalyticsRecord {
        pid: std::process::id(),
        host: host.clone(),
        port: local_addr.port(),
        url: format!("http://{}", local_addr),
        started_at: now_string(),
    };
    write_analytics_record(&paths, &record)?;
    append_analytics_log(
        &paths,
        &format!("analytics daemon started at {}", record.url),
    );

    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
    let state = Arc::new(AnalyticsState {
        paths: paths.clone(),
        record,
        shutdown_tx: Arc::new(Mutex::new(Some(shutdown_tx))),
    });

    tokio::spawn(snapshot_loop(paths.clone()));

    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let (stream, _) = accepted.context("accept analytics API connection")?;
                let state = state.clone();
                tokio::spawn(async move {
                    if let Err(error) = handle_connection(stream, state).await {
                        eprintln!("analytics API request failed: {error:#}");
                    }
                });
            }
            _ = &mut shutdown_rx => {
                break;
            }
        }
    }

    append_analytics_log(&paths, "analytics daemon stopped");
    remove_analytics_record(&paths)?;
    Ok(())
}

async fn snapshot_loop(paths: StatePaths) {
    loop {
        let snapshot = collect_analytics_snapshot(&paths, "analytics-daemon");
        let _ = write_snapshot(&paths, &snapshot);
        sleep(Duration::from_secs(5)).await;
    }
}

pub fn collect_analytics_snapshot(
    paths: &StatePaths,
    source: impl Into<String>,
) -> AnalyticsSnapshot {
    let queue = read_queue_items(paths).unwrap_or_default();
    let runs = read_json_values_from_dir(&paths.runs_dir);
    let telemetry = read_json_lines(&paths.telemetry_log);
    let generated_at = now_string();
    let services = service_metrics(paths);
    let versions = version_metrics(paths);
    let work = work_metrics(&queue, &runs);
    let telemetry_metrics = telemetry_metrics(&telemetry);
    let timestamps = runtime_timestamps(paths, Some(generated_at.clone()));
    let recent_errors = recent_errors(paths, &runs, &telemetry);
    let snapshot = AnalyticsSnapshot {
        success: true,
        generated_at,
        source: source.into(),
        state_dir: paths.root.display().to_string(),
        services,
        versions,
        work,
        telemetry: telemetry_metrics,
        timestamps,
        recent_errors,
    };
    let _ = write_snapshot(paths, &snapshot);
    snapshot
}

fn service_metrics(paths: &StatePaths) -> ServiceMetrics {
    let main_daemon = read_daemon_record(paths)
        .ok()
        .flatten()
        .map(|record| ServiceRecord {
            pid: record.pid,
            host: record.host,
            port: record.port,
            url: record.url,
            running: process_is_running(record.pid),
            started_at: record.started_at,
        });
    let analytics_daemon =
        read_analytics_record(paths)
            .ok()
            .flatten()
            .map(|record| ServiceRecord {
                pid: record.pid,
                host: record.host,
                port: record.port,
                url: record.url,
                running: process_is_running(record.pid),
                started_at: record.started_at,
            });
    let web_server = read_web_server_record(paths).ok().flatten();
    let active_daemons = [main_daemon.as_ref(), analytics_daemon.as_ref()]
        .into_iter()
        .flatten()
        .filter(|record| record.running)
        .count();
    ServiceMetrics {
        active_daemons,
        main_daemon,
        analytics_daemon,
        web_server,
    }
}

fn version_metrics(paths: &StatePaths) -> VersionMetrics {
    let install = read_install_record(paths).ok().flatten();
    let update = read_json_value(&paths.update_json);
    VersionMetrics {
        runtime_version: VERSION.to_string(),
        installed_version: install.as_ref().map(|record| record.version.clone()),
        installed_channel: install.as_ref().map(|record| record.channel.clone()),
        installed_at: install.as_ref().map(|record| record.installed_at.clone()),
        update_channel: update
            .as_ref()
            .and_then(|value| string_field(value, &["channel"])),
        latest_allowed_version: update.as_ref().and_then(|value| {
            string_field(value, &["latestAllowedVersion", "latest_allowed_version"])
        }),
        update_available: update
            .as_ref()
            .and_then(|value| {
                value
                    .get("updateAvailable")
                    .or_else(|| value.get("update_available"))
            })
            .and_then(Value::as_bool),
    }
}

fn work_metrics(queue: &[crate::daemon::QueueItem], runs: &[Value]) -> WorkMetrics {
    let running_statuses = ["queued", "running"];
    let mut active_agent_ids = HashSet::new();
    let mut running_runs = 0;
    let mut completed_runs = 0;
    let mut failed_runs = 0;
    let mut rejected_runs = 0;

    for run in runs {
        let status = string_field(run, &["status"]).unwrap_or_default();
        match status.as_str() {
            "queued" | "running" => {
                running_runs += 1;
                if let Some(agent_id) = string_field(run, &["agentId", "agent_id"]) {
                    if !agent_id.trim().is_empty() {
                        active_agent_ids.insert(agent_id);
                    }
                }
            }
            "completed" => completed_runs += 1,
            "failed" => failed_runs += 1,
            "rejected" => rejected_runs += 1,
            _ => {}
        }
    }

    let queue_depth = queue.len();
    let queued_jobs = queue.iter().filter(|item| item.status == "queued").count();
    let scheduled_jobs = queue
        .iter()
        .filter(|item| {
            item.scheduled_for
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
        })
        .count();
    let queue_active = queue
        .iter()
        .filter(|item| running_statuses.contains(&item.status.as_str()))
        .count();
    let active_work = running_runs + queue_active;
    let working_agents = active_agent_ids.len().max(active_work);
    let completed_or_failed = completed_runs + failed_runs;
    let failure_rate = if completed_or_failed == 0 {
        0.0
    } else {
        failed_runs as f64 / completed_or_failed as f64
    };

    WorkMetrics {
        queue_depth,
        queued_jobs,
        scheduled_jobs,
        active_work,
        online_members: working_agents,
        working_agents,
        total_runs: runs.len(),
        running_runs,
        completed_runs,
        failed_runs,
        rejected_runs,
        queue_volume: queue.len() + runs.len(),
        failure_rate,
    }
}

fn telemetry_metrics(events: &[Value]) -> TelemetryMetrics {
    let mut event_counts = BTreeMap::new();
    let mut client_type_counts = BTreeMap::new();
    let mut surface_counts = BTreeMap::new();
    let mut last_event_at = None;

    for event in events {
        if let Some(name) = string_field(event, &["event"]) {
            *event_counts.entry(name).or_insert(0) += 1;
        }
        if let Some(client_type) = string_field(event, &["clientType", "client_type"]) {
            *client_type_counts.entry(client_type).or_insert(0) += 1;
        }
        if let Some(surface) = string_field(event, &["surface"]) {
            *surface_counts.entry(surface).or_insert(0) += 1;
        }
        if let Some(timestamp) = string_field(event, &["timestamp"]) {
            last_event_at = Some(timestamp);
        }
    }

    let queue_created = event_counts.get("queue.created").copied().unwrap_or(0);
    let queue_started = event_counts.get("queue.started").copied().unwrap_or(0)
        + event_counts
            .get("active_work.started")
            .copied()
            .unwrap_or(0);
    let queue_completed = event_counts.get("queue.completed").copied().unwrap_or(0);
    let queue_failed = event_counts.get("queue.failed").copied().unwrap_or(0);
    let errors = event_counts.get("error").copied().unwrap_or(0);
    TelemetryMetrics {
        total_events: events.len(),
        event_counts,
        client_type_counts,
        surface_counts,
        queue_created,
        queue_started,
        queue_completed,
        queue_failed,
        errors,
        last_event_at,
    }
}

fn runtime_timestamps(paths: &StatePaths, last_snapshot_at: Option<String>) -> RuntimeTimestamps {
    RuntimeTimestamps {
        last_device_registration_at: timestamp_field(
            &paths.device_registration_json,
            &["registeredAt", "registered_at"],
        ),
        last_ping_at: timestamp_field(&paths.ping_json, &["pingedAt", "pinged_at"]),
        last_feature_flag_check_at: timestamp_field(
            &paths.feature_flags_json,
            &["checkedAt", "checked_at"],
        ),
        last_telemetry_flush_at: timestamp_field(
            &paths.telemetry_flush_json,
            &["flushedAt", "flushed_at"],
        ),
        last_sync_at: timestamp_field(&paths.sync_json, &["syncedAt", "synced_at"]),
        last_update_check_at: timestamp_field(&paths.update_json, &["checkedAt", "checked_at"]),
        last_snapshot_at,
    }
}

fn recent_errors(paths: &StatePaths, runs: &[Value], telemetry: &[Value]) -> Vec<RecentError> {
    let mut errors = Vec::new();

    for run in runs {
        if string_field(run, &["status"]).as_deref() == Some("failed") {
            errors.push(RecentError {
                at: string_field(
                    run,
                    &[
                        "completedAt",
                        "completed_at",
                        "startedAt",
                        "started_at",
                        "createdAt",
                        "created_at",
                    ],
                ),
                source: "run".to_string(),
                message: string_field(run, &["prompt"]).unwrap_or_else(|| "run failed".to_string()),
                run_id: string_field(run, &["id"]),
            });
        }
    }

    for event in telemetry.iter().rev() {
        let event_name = string_field(event, &["event"]).unwrap_or_default();
        let remote_error = event
            .get("metadata")
            .and_then(|metadata| string_field(metadata, &["remoteError", "remote_error", "error"]));
        if event_name.contains("error") || remote_error.is_some() {
            errors.push(RecentError {
                at: string_field(event, &["timestamp"]),
                source: string_field(event, &["surface"])
                    .unwrap_or_else(|| "telemetry".to_string()),
                message: remote_error.unwrap_or(event_name),
                run_id: event
                    .get("metadata")
                    .and_then(|metadata| string_field(metadata, &["runId", "run_id", "id"])),
            });
        }
    }

    for line in tail_lines(&paths.server_log, 40) {
        let lower = line.to_ascii_lowercase();
        if lower.contains("failed") || lower.contains("error") {
            errors.push(RecentError {
                at: line.split_whitespace().next().map(ToString::to_string),
                source: "server-log".to_string(),
                message: line,
                run_id: None,
            });
        }
    }

    errors.sort_by(|a, b| b.at.cmp(&a.at));
    errors.truncate(8);
    errors
}

async fn handle_connection(mut stream: TcpStream, state: Arc<AnalyticsState>) -> Result<()> {
    let request = read_http_request(&mut stream).await?;
    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/health") | ("GET", "/status") => {
            write_json_response(
                &mut stream,
                200,
                &LifecycleResponse {
                    success: true,
                    message: format!("autohand-squad-analytics {}", state.record.url),
                },
            )
            .await
        }
        ("GET", "/metrics") => {
            let snapshot = collect_analytics_snapshot(&state.paths, "analytics-daemon");
            write_json_response(&mut stream, 200, &snapshot).await
        }
        ("POST", "/stop") => {
            if let Some(tx) = state.shutdown_tx.lock().await.take() {
                let _ = tx.send(());
            }
            write_json_response(
                &mut stream,
                200,
                &LifecycleResponse {
                    success: true,
                    message: "analytics daemon stopping".to_string(),
                },
            )
            .await
        }
        _ => {
            write_json_response(
                &mut stream,
                404,
                &LifecycleResponse {
                    success: false,
                    message: "not found".to_string(),
                },
            )
            .await
        }
    }
}

async fn read_http_request(stream: &mut TcpStream) -> Result<HttpRequest> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];
    let mut header_end = None;
    let mut content_length = 0_usize;

    loop {
        let count = stream.read(&mut chunk).await?;
        if count == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..count]);
        if header_end.is_none() {
            header_end = find_header_end(&buffer);
            if let Some(end) = header_end {
                let headers = String::from_utf8_lossy(&buffer[..end]);
                content_length = parse_content_length(&headers);
            }
        }
        if let Some(end) = header_end {
            if buffer.len() >= end + 4 + content_length {
                break;
            }
        }
        if buffer.len() > 1024 * 1024 {
            bail!("request too large");
        }
    }

    let end = header_end.ok_or_else(|| anyhow!("invalid HTTP request"))?;
    let headers = String::from_utf8_lossy(&buffer[..end]);
    let request_line = headers
        .lines()
        .next()
        .ok_or_else(|| anyhow!("missing request line"))?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts
        .next()
        .unwrap_or("/")
        .split('?')
        .next()
        .unwrap_or("/")
        .to_string();
    Ok(HttpRequest { method, path })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn parse_content_length(headers: &str) -> usize {
    headers
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })
        .unwrap_or(0)
}

async fn write_json_response<T>(stream: &mut TcpStream, status: u16, value: &T) -> Result<()>
where
    T: Serialize,
{
    let body = serde_json::to_string(value)?;
    let reason = match status {
        200 => "OK",
        404 => "Not Found",
        _ => "OK",
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    stream.write_all(response.as_bytes()).await?;
    stream.shutdown().await?;
    Ok(())
}

fn read_json_values_from_dir(dir: &Path) -> Vec<Value> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut values = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("json"))
        .filter_map(|path| read_json_value(&path))
        .collect::<Vec<_>>();
    values.sort_by(|a, b| {
        string_field(b, &["createdAt", "created_at"])
            .cmp(&string_field(a, &["createdAt", "created_at"]))
    });
    values
}

fn read_json_lines(path: &Path) -> Vec<Value> {
    fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect()
}

fn read_json_value(path: &Path) -> Option<Value> {
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn timestamp_field(path: &Path, fields: &[&str]) -> Option<String> {
    let value = read_json_value(path)?;
    string_field(&value, fields)
}

fn string_field(value: &Value, fields: &[&str]) -> Option<String> {
    fields.iter().find_map(|field| {
        value
            .get(*field)
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(ToString::to_string)
    })
}

fn tail_lines(path: &Path, limit: usize) -> Vec<String> {
    let mut lines = fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    if lines.len() > limit {
        lines.drain(0..lines.len() - limit);
    }
    lines
}

fn write_snapshot(paths: &StatePaths, snapshot: &AnalyticsSnapshot) -> Result<()> {
    write_json(&paths.analytics_snapshot_json, snapshot)
}

fn write_json<T: Serialize>(path: &PathBuf, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;
    }
    let content = serde_json::to_string_pretty(value)?;
    fs::write(path, format!("{content}\n")).with_context(|| format!("write {}", path.display()))?;
    Ok(())
}

fn append_analytics_log(paths: &StatePaths, message: &str) {
    let _ = paths.ensure();
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.analytics_log)
    {
        let _ = writeln!(file, "{} {}", now_string(), message);
    }
}

fn process_is_running(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }

    #[cfg(target_family = "unix")]
    {
        Command::new("kill")
            .arg("-0")
            .arg(pid.to_string())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}")])
            .output()
            .map(|output| String::from_utf8_lossy(&output.stdout).contains(&pid.to_string()))
            .unwrap_or(false)
    }

    #[cfg(not(any(target_family = "unix", target_os = "windows")))]
    {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{
        write_analytics_record, write_daemon_record, AnalyticsRecord, DaemonRecord,
    };
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_state_paths() -> StatePaths {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        StatePaths::from_root(std::env::temp_dir().join(format!(
            "autohand-squad-analytics-test-{}-{nonce}",
            std::process::id()
        )))
    }

    #[test]
    fn snapshot_aggregates_queue_runs_and_telemetry() {
        let paths = temp_state_paths();
        paths.ensure().unwrap();
        fs::write(
            paths.queue_dir.join("queued.json"),
            r#"{"id":"queued","status":"queued","scheduledFor":"2026-05-26T12:00:00Z"}"#,
        )
        .unwrap();
        fs::write(
            paths.runs_dir.join("run-1.json"),
            r#"{"id":"run-1","status":"running","prompt":"ship","agentId":"asq_1","createdAt":"unix-ms:1"}"#,
        )
        .unwrap();
        fs::write(
            paths.runs_dir.join("run-2.json"),
            r#"{"id":"run-2","status":"failed","prompt":"break","agentId":"asq_2","createdAt":"unix-ms:2","completedAt":"unix-ms:3"}"#,
        )
        .unwrap();
        fs::write(
            &paths.telemetry_log,
            concat!(
                r#"{"event":"queue.created","timestamp":"unix-ms:1","clientType":"squad","surface":"squad-daemon"}"#,
                "\n",
                r#"{"event":"queue.failed","timestamp":"unix-ms:2","clientType":"squad","surface":"squad-daemon"}"#,
                "\n",
                r#"{"event":"error","timestamp":"unix-ms:3","clientType":"squad","surface":"squad-daemon","metadata":{"runId":"run-2","error":"boom"}}"#,
                "\n"
            ),
        )
        .unwrap();

        let snapshot = collect_analytics_snapshot(&paths, "test");

        assert_eq!(snapshot.work.queue_depth, 1);
        assert_eq!(snapshot.work.scheduled_jobs, 1);
        assert_eq!(snapshot.work.active_work, 2);
        assert_eq!(snapshot.work.failed_runs, 1);
        assert_eq!(snapshot.telemetry.total_events, 3);
        assert_eq!(snapshot.telemetry.queue_created, 1);
        assert_eq!(snapshot.telemetry.queue_failed, 1);
        assert_eq!(snapshot.telemetry.errors, 1);
        assert!(!snapshot.recent_errors.is_empty());
        let _ = fs::remove_dir_all(paths.root);
    }

    #[test]
    fn snapshot_counts_known_service_records() {
        let paths = temp_state_paths();
        paths.ensure().unwrap();
        write_daemon_record(
            &paths,
            &DaemonRecord {
                pid: std::process::id(),
                host: "127.0.0.1".to_string(),
                port: 19821,
                url: "http://127.0.0.1:19821".to_string(),
                accepting_work: true,
                started_at: "unix-ms:1".to_string(),
                drain_requested_at: None,
            },
        )
        .unwrap();
        write_analytics_record(
            &paths,
            &AnalyticsRecord {
                pid: std::process::id(),
                host: "127.0.0.1".to_string(),
                port: DEFAULT_ANALYTICS_PORT,
                url: "http://127.0.0.1:19823".to_string(),
                started_at: "unix-ms:2".to_string(),
            },
        )
        .unwrap();

        let snapshot = collect_analytics_snapshot(&paths, "test");

        assert_eq!(snapshot.services.active_daemons, 2);
        assert_eq!(snapshot.services.main_daemon.as_ref().unwrap().port, 19821);
        assert_eq!(
            snapshot.services.analytics_daemon.as_ref().unwrap().port,
            DEFAULT_ANALYTICS_PORT
        );
        let _ = fs::remove_dir_all(paths.root);
    }
}
