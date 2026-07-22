use crate::api::{ApiClient, RemoteMetrics, TelemetryFlushSnapshot};
use crate::config::{resolve_config, ConfigOverrides, SquadConfig};
use crate::live_status::{
    read_fresh_live_status_snapshot, LiveStatusAutomation, LiveStatusJob, LiveStatusMember,
};
use crate::state::{
    default_state_paths, ensure_device_id, now_string, read_channels_state, read_daemon_record,
    remove_daemon_record, write_channels_state, write_daemon_record, ChannelsState, DaemonRecord,
    StatePaths,
};
use crate::telemetry::{append_telemetry_event, daemon_event, TelemetryEvent};
use crate::VERSION;
use anyhow::{anyhow, bail, Context, Result};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::process::Command;
use tokio::sync::oneshot;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub id: String,
    pub status: String,
    pub prompt: Option<String>,
    pub created_at: Option<String>,
    pub scheduled_for: Option<String>,
    pub workspace: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountState {
    pub email: Option<String>,
    pub plan_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StatusResponse {
    pub success: bool,
    pub service: String,
    pub version: String,
    pub url: String,
    pub state_dir: String,
    pub device_id: String,
    pub accepting_work: bool,
    pub queue_depth: usize,
    pub active_runs: usize,
    #[serde(default)]
    pub running_sessions: usize,
    #[serde(default)]
    pub active_trigger_work: usize,
    pub account: AccountState,
    pub online_members: usize,
    pub working_agents: usize,
    pub queued_jobs: usize,
    pub scheduled_jobs: usize,
    #[serde(default)]
    pub channels: usize,
    #[serde(default)]
    pub channel_threads: usize,
    #[serde(default)]
    pub members: Vec<LiveStatusMember>,
    #[serde(default)]
    pub jobs: Vec<LiveStatusJob>,
    #[serde(default)]
    pub automations: Vec<LiveStatusAutomation>,
    pub launch_at_login_policy: String,
    pub telemetry_policy: String,
    pub last_device_registration_at: Option<String>,
    pub last_ping_at: Option<String>,
    pub last_feature_flag_check_at: Option<String>,
    pub last_telemetry_flush_at: Option<String>,
    pub last_sync_at: Option<String>,
    pub last_update_check_at: Option<String>,
    pub daemon: Option<DaemonRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QueueResponse {
    pub success: bool,
    pub items: Vec<QueueItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleResponse {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
    pub email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueRequest {
    pub prompt: String,
    pub workspace: Option<String>,
    pub scheduled_for: Option<String>,
    #[serde(default)]
    pub channel_id: Option<String>,
    #[serde(default)]
    pub thread_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    pub prompt: String,
    pub workspace: Option<String>,
    pub agent_id: Option<String>,
    pub extra_args: Option<Vec<String>>,
    #[serde(default)]
    pub channel_id: Option<String>,
    #[serde(default)]
    pub thread_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    pub id: String,
    pub status: String,
    pub prompt: String,
    pub workspace: Option<String>,
    pub agent_id: Option<String>,
    pub command: Vec<String>,
    pub log_path: String,
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub exit_code: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunsResponse {
    pub success: bool,
    pub runs: Vec<RunRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LogResponse {
    pub success: bool,
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncSnapshot {
    pub success: bool,
    pub synced_at: String,
    pub api_base_url: String,
    pub client_type: String,
    pub surface: String,
    pub version: String,
    pub device_id: String,
    pub queue_depth: usize,
    pub queued_jobs: usize,
    pub scheduled_jobs: usize,
    pub active_work: usize,
    pub online_members: usize,
    pub plan_state: String,
    pub run_count: usize,
    pub remote_status: Option<u16>,
    pub remote_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSnapshot {
    pub success: bool,
    pub checked_at: String,
    pub channel: String,
    pub client_type: String,
    pub surface: String,
    pub device_id: String,
    pub current_version: String,
    pub latest_allowed_version: Option<String>,
    pub update_available: bool,
    pub manifest_url: String,
    pub error: Option<String>,
}

#[derive(Clone)]
struct AppState {
    paths: StatePaths,
    config: SquadConfig,
    account_email: Arc<StdMutex<Option<String>>>,
    accepting_work: Arc<AtomicBool>,
    shutdown_tx: Arc<Mutex<Option<oneshot::Sender<()>>>>,
    device_id: String,
}

pub async fn run_daemon(overrides: ConfigOverrides) -> Result<()> {
    let paths = default_state_paths();
    run_daemon_with_paths(paths, overrides).await
}

pub async fn run_daemon_with_paths(paths: StatePaths, overrides: ConfigOverrides) -> Result<()> {
    paths.ensure()?;
    let mut config = resolve_config(&paths, overrides)?;
    let device_id = ensure_device_id(&paths)?;
    let requested_port = config.port;
    let requested_open_url = config.open_url.clone();
    let socket: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .with_context(|| format!("parse daemon address {}:{}", config.host, config.port))?;
    let listener = TcpListener::bind(socket)
        .await
        .with_context(|| format!("bind {}", socket))?;
    let local_addr = listener.local_addr()?;
    config.port = local_addr.port();
    if requested_open_url == format!("http://{}:{requested_port}", config.host) {
        config.open_url = config.base_url();
    }
    let url = format!("http://{}", local_addr);

    let record = DaemonRecord {
        pid: std::process::id(),
        host: config.host.clone(),
        port: local_addr.port(),
        url: url.clone(),
        accepting_work: true,
        started_at: now_string(),
        drain_requested_at: None,
    };
    write_daemon_record(&paths, &record)?;

    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
    let state = Arc::new(AppState {
        paths: paths.clone(),
        account_email: Arc::new(StdMutex::new(config.account_email.clone())),
        config,
        accepting_work: Arc::new(AtomicBool::new(true)),
        shutdown_tx: Arc::new(Mutex::new(Some(shutdown_tx))),
        device_id,
    });
    record_daemon_event(
        &state,
        "daemon.started",
        json!({
            "host": state.config.host,
            "port": state.config.port,
            "openUrl": state.config.open_url,
            "launchAtLoginPolicy": state.config.launch_at_login_policy,
            "telemetryPolicy": state.config.telemetry_policy
        }),
    );
    spawn_observability_loop(state.clone());

    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let (stream, _) = accepted.context("accept local Squad API connection")?;
                let state = state.clone();
                tokio::spawn(async move {
                    if let Err(error) = handle_connection(stream, state).await {
                        eprintln!("local Squad API request failed: {error:#}");
                    }
                });
            }
            _ = &mut shutdown_rx => {
                break;
            }
        }
    }

    remove_daemon_record(&paths)?;
    Ok(())
}

#[derive(Debug)]
struct HttpRequest {
    method: String,
    path: String,
    body: String,
}

async fn handle_connection(mut stream: TcpStream, state: Arc<AppState>) -> Result<()> {
    let request = read_http_request(&mut stream).await?;
    route_request(&mut stream, &state, request).await
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
    let mut lines = headers.lines();
    let request_line = lines
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
    let body_bytes = &buffer[end + 4..end + 4 + content_length.min(buffer.len() - end - 4)];
    let body = String::from_utf8_lossy(body_bytes).to_string();

    Ok(HttpRequest { method, path, body })
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

async fn route_request(
    stream: &mut TcpStream,
    state: &Arc<AppState>,
    request: HttpRequest,
) -> Result<()> {
    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/health") => write_json_response(stream, 200, &health()).await,
        ("GET", "/status") => write_json_response(stream, 200, &status_payload(state)).await,
        ("GET", "/queue") => write_json_response(stream, 200, &queue_response(state)).await,
        ("POST", "/queue") => {
            let input = parse_json_body::<EnqueueRequest>(&request.body)?;
            let (status, item) = enqueue_response(state, input);
            write_json_response(stream, status, &item).await
        }
        ("GET", "/channels") => {
            let channels = read_channels_state(&state.paths)
                .ok()
                .flatten()
                .unwrap_or_default();
            write_json_response(stream, 200, &channels).await
        }
        ("POST" | "PUT", "/channels") => {
            let input = parse_json_body::<ChannelsState>(&request.body)?;
            let (status, response) = channels_sync_response(state, input);
            write_json_response(stream, status, &response).await
        }
        ("GET", "/config") => write_json_response(stream, 200, &state.config).await,
        ("GET", "/runs") => write_json_response(stream, 200, &runs_response(state)).await,
        ("POST", "/runs") => {
            let input = parse_json_body::<RunRequest>(&request.body)?;
            let (status, record) = start_run_response(state, input);
            write_json_response(stream, status, &record).await
        }
        ("GET", "/logs") => write_json_response(stream, 200, &server_logs_response(state)).await,
        ("POST", "/telemetry") => {
            let event = parse_json_body::<TelemetryEvent>(&request.body)?;
            let response = telemetry_response(state, event);
            write_json_response(stream, 200, &response).await
        }
        ("POST", "/sync") => {
            let response = sync_now_response(state).await;
            write_json_response(stream, 200, &response).await
        }
        ("POST", "/devices/register") => {
            let response = register_device_response(state).await;
            write_json_response(stream, 200, &response).await
        }
        ("POST", "/feature-flags/check") => {
            let response = feature_flags_response(state).await;
            write_json_response(stream, 200, &response).await
        }
        ("POST", "/telemetry/flush") => {
            let response = telemetry_flush_response(state).await;
            write_json_response(stream, 200, &response).await
        }
        ("POST", "/updates/check") => {
            let response = check_updates_response(state).await;
            write_json_response(stream, 200, &response).await
        }
        ("POST", "/heartbeat") => {
            let response = heartbeat_response(state).await;
            write_json_response(stream, 200, &response).await
        }
        ("POST", "/auth/login") => {
            let input = parse_json_body::<LoginRequest>(&request.body)?;
            let (status, response) = login_response(state, input);
            write_json_response(stream, status, &response).await
        }
        ("POST", "/auth/logout") => {
            let response = logout_response(state);
            write_json_response(stream, 200, &response).await
        }
        ("POST", "/launch-at-login/toggle") => {
            let response = launch_at_login_response(state);
            write_json_response(stream, 200, &response).await
        }
        ("POST", "/restart") => {
            let (status, response) = restart_response(state);
            write_json_response(stream, status, &response).await
        }
        ("POST", "/stop") => {
            let response = stop_response(state).await;
            write_json_response(stream, 200, &response).await
        }
        ("GET", path) if path.starts_with("/runs/") && path.ends_with("/logs") => {
            let id = path
                .trim_start_matches("/runs/")
                .trim_end_matches("/logs")
                .trim_end_matches('/');
            let (status, response) = run_logs_response(state, id);
            write_json_response(stream, status, &response).await
        }
        ("GET", path) if path.starts_with("/runs/") => {
            let id = path.trim_start_matches("/runs/");
            match read_run_record(&state.paths, id).ok().flatten() {
                Some(record) => write_json_response(stream, 200, &Some(record)).await,
                None => write_json_response::<Option<RunRecord>>(stream, 404, &None).await,
            }
        }
        _ => {
            let response = LifecycleResponse {
                success: false,
                message: "not found".to_string(),
            };
            write_json_response(stream, 404, &response).await
        }
    }
}

fn parse_json_body<T>(body: &str) -> Result<T>
where
    T: DeserializeOwned,
{
    serde_json::from_str(body).context("parse JSON request body")
}

async fn write_json_response<T>(stream: &mut TcpStream, status: u16, value: &T) -> Result<()>
where
    T: Serialize,
{
    let body = serde_json::to_string(value)?;
    let reason = match status {
        200 => "OK",
        201 => "Created",
        202 => "Accepted",
        400 => "Bad Request",
        404 => "Not Found",
        503 => "Service Unavailable",
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

fn health() -> LifecycleResponse {
    LifecycleResponse {
        success: true,
        message: format!("autohand-squad-daemon {VERSION}"),
    }
}

fn queue_response(state: &AppState) -> QueueResponse {
    QueueResponse {
        success: true,
        items: read_queue_items(&state.paths).unwrap_or_default(),
    }
}

fn enqueue_response(state: &AppState, request: EnqueueRequest) -> (u16, QueueItem) {
    if !state.accepting_work.load(Ordering::SeqCst) {
        return (
            503,
            QueueItem {
                id: "rejected".to_string(),
                status: "rejected".to_string(),
                prompt: Some(request.prompt),
                created_at: Some(now_string()),
                scheduled_for: request.scheduled_for,
                workspace: request.workspace,
                channel_id: request.channel_id,
                thread_id: request.thread_id,
            },
        );
    }

    let item = QueueItem {
        id: next_id(),
        status: "queued".to_string(),
        prompt: Some(request.prompt),
        created_at: Some(now_string()),
        scheduled_for: request.scheduled_for,
        workspace: request.workspace,
        channel_id: request.channel_id,
        thread_id: request.thread_id,
    };
    if let Err(error) = write_queue_item(&state.paths, &item) {
        append_server_log(&state.paths, &format!("queue write failed: {error:#}"));
    }
    record_daemon_event(
        state,
        "queue.created",
        json!({
            "id": item.id,
            "workspace": item.workspace,
            "scheduledFor": item.scheduled_for,
            "channelId": item.channel_id,
            "threadId": item.thread_id,
            "queueDepth": read_queue_items(&state.paths).map(|items| items.len()).unwrap_or(0)
        }),
    );
    (201, item)
}
fn runs_response(state: &AppState) -> RunsResponse {
    RunsResponse {
        success: true,
        runs: read_run_records(&state.paths).unwrap_or_default(),
    }
}

fn start_run_response(state: &AppState, request: RunRequest) -> (u16, RunRecord) {
    if !state.accepting_work.load(Ordering::SeqCst) {
        let record = new_run_record(&state.paths, request, "rejected");
        return (503, record);
    }

    let mut record = new_run_record(&state.paths, request, "queued");
    let _ = write_run_record(&state.paths, &record);
    record_daemon_event(
        state,
        "queue.started",
        json!({
            "id": record.id,
            "agentId": record.agent_id,
            "workspace": record.workspace
        }),
    );
    spawn_run_worker(
        state.paths.clone(),
        record.clone(),
        state.device_id.clone(),
        state.config.telemetry_enabled(),
    );
    record.status = "running".to_string();
    (202, record)
}

fn run_logs_response(state: &AppState, id: &str) -> (u16, LogResponse) {
    let log_path = state.paths.runs_dir.join(format!("{id}.log"));
    match fs::read_to_string(&log_path) {
        Ok(content) => (
            200,
            LogResponse {
                success: true,
                path: log_path.display().to_string(),
                content,
            },
        ),
        Err(_) => (
            404,
            LogResponse {
                success: false,
                path: log_path.display().to_string(),
                content: String::new(),
            },
        ),
    }
}

fn server_logs_response(state: &AppState) -> LogResponse {
    let content = fs::read_to_string(&state.paths.server_log).unwrap_or_default();
    LogResponse {
        success: true,
        path: state.paths.server_log.display().to_string(),
        content,
    }
}

fn telemetry_response(state: &AppState, event: TelemetryEvent) -> LifecycleResponse {
    if state.config.telemetry_enabled() {
        let mut event = event;
        if event.client_type.is_none() {
            event.client_type = Some("squad".to_string());
        }
        if event.surface.is_none() {
            event.surface = Some("squad-daemon".to_string());
        }
        if event.device_id.is_none() {
            event.device_id = Some(state.device_id.clone());
        }
        let _ = append_telemetry_event(&state.paths, event);
    }
    LifecycleResponse {
        success: true,
        message: "telemetry queued".to_string(),
    }
}

async fn heartbeat_response(state: &AppState) -> LifecycleResponse {
    let metrics = daemon_metrics(state);
    record_daemon_event(
        state,
        "daemon.heartbeat",
        json!({
            "queueDepth": metrics.queue_depth,
            "queuedJobs": metrics.queued_jobs,
            "scheduledJobs": metrics.scheduled_jobs,
            "activeWork": metrics.active_runs,
            "onlineMembers": metrics.online_members,
            "planState": state.config.plan_state
        }),
    );
    let ping = send_ping(state, metrics).await;
    if let Some(error) = ping.remote_error {
        append_server_log(
            &state.paths,
            &format!("heartbeat remote ping failed: {error}"),
        );
    }
    LifecycleResponse {
        success: true,
        message: "heartbeat recorded".to_string(),
    }
}

fn logout_response(state: &AppState) -> LifecycleResponse {
    let previous_account = current_account_email(state);
    if let Ok(mut account_email) = state.account_email.lock() {
        *account_email = None;
    }
    record_daemon_event(
        state,
        "account.logout_requested",
        json!({ "accountEmail": previous_account }),
    );
    LifecycleResponse {
        success: true,
        message: previous_account
            .map(|email| format!("logged out {email}"))
            .unwrap_or_else(|| "already logged out".to_string()),
    }
}

fn login_response(state: &AppState, request: LoginRequest) -> (u16, LifecycleResponse) {
    let Some(email) = normalize_account_email(&request.email) else {
        return (
            400,
            LifecycleResponse {
                success: false,
                message: "email is required".to_string(),
            },
        );
    };

    if let Ok(mut account_email) = state.account_email.lock() {
        *account_email = Some(email.clone());
    } else {
        return (
            503,
            LifecycleResponse {
                success: false,
                message: "account state unavailable".to_string(),
            },
        );
    }

    record_daemon_event(
        state,
        "account.login_requested",
        json!({ "accountEmail": email }),
    );
    (
        200,
        LifecycleResponse {
            success: true,
            message: format!("logged in as {email}"),
        },
    )
}

fn launch_at_login_response(state: &AppState) -> LifecycleResponse {
    record_daemon_event(
        state,
        "launch_at_login.toggle_requested",
        json!({ "policy": state.config.launch_at_login_policy }),
    );
    LifecycleResponse {
        success: true,
        message: format!(
            "launch at login policy is {}",
            state.config.launch_at_login_policy
        ),
    }
}

async fn sync_now_response(state: &AppState) -> SyncSnapshot {
    let metrics = daemon_metrics(state);
    let mut snapshot = SyncSnapshot {
        success: true,
        synced_at: now_string(),
        api_base_url: state.config.api_base_url.clone(),
        client_type: "squad".to_string(),
        surface: "squad-daemon".to_string(),
        version: VERSION.to_string(),
        device_id: state.device_id.clone(),
        queue_depth: metrics.queue_depth,
        queued_jobs: metrics.queued_jobs,
        scheduled_jobs: metrics.scheduled_jobs,
        active_work: metrics.active_runs,
        online_members: metrics.online_members,
        plan_state: state.config.plan_state.clone(),
        run_count: metrics.run_count,
        remote_status: None,
        remote_error: None,
    };

    let ping = send_ping(state, metrics).await;
    snapshot.remote_status = ping.remote_status;
    snapshot.remote_error = ping.remote_error;

    let _ = write_json(&state.paths.sync_json, &snapshot);
    record_daemon_event(
        state,
        "api.sync",
        json!({
            "apiBaseUrl": snapshot.api_base_url,
            "queueDepth": snapshot.queue_depth,
            "activeWork": snapshot.active_work,
            "remoteStatus": snapshot.remote_status,
            "remoteError": snapshot.remote_error
        }),
    );
    snapshot
}

async fn register_device_response(state: &AppState) -> crate::api::DeviceRegistrationSnapshot {
    let api = ApiClient::new(state.config.clone(), state.device_id.clone());
    let snapshot = api.register_device().await;
    let _ = write_json(&state.paths.device_registration_json, &snapshot);
    record_daemon_event(
        state,
        "device.registered",
        json!({
            "remoteStatus": snapshot.remote_status,
            "remoteError": snapshot.remote_error,
            "apiBaseUrl": snapshot.api_base_url
        }),
    );
    snapshot
}

async fn feature_flags_response(state: &AppState) -> crate::api::FeatureFlagSnapshot {
    let api = ApiClient::new(state.config.clone(), state.device_id.clone());
    let snapshot = api.fetch_feature_flags().await;
    let _ = write_json(&state.paths.feature_flags_json, &snapshot);
    record_daemon_event(
        state,
        "feature_flags.checked",
        json!({
            "remoteStatus": snapshot.remote_status,
            "remoteError": snapshot.remote_error,
            "flags": snapshot.flags.iter().map(|flag| flag.key.clone()).collect::<Vec<_>>()
        }),
    );
    snapshot
}

async fn telemetry_flush_response(state: &AppState) -> TelemetryFlushSnapshot {
    if !state.config.telemetry_enabled() {
        let snapshot = TelemetryFlushSnapshot {
            success: true,
            flushed_at: now_string(),
            api_base_url: state.config.api_base_url.clone(),
            client_type: "squad".to_string(),
            surface: "squad-daemon".to_string(),
            version: VERSION.to_string(),
            device_id: state.device_id.clone(),
            events_sent: 0,
            remote_status: None,
            remote_error: Some("telemetry policy disabled".to_string()),
        };
        let _ = write_json(&state.paths.telemetry_flush_json, &snapshot);
        return snapshot;
    }

    let events = read_telemetry_events(&state.paths, 250);
    let api = ApiClient::new(state.config.clone(), state.device_id.clone());
    let snapshot = api.send_telemetry_batch(&events).await;
    let _ = write_json(&state.paths.telemetry_flush_json, &snapshot);
    snapshot
}

async fn send_ping(state: &AppState, metrics: DaemonMetrics) -> crate::api::PingSnapshot {
    let api = ApiClient::new(state.config.clone(), state.device_id.clone());
    let snapshot = api.send_ping(remote_metrics(metrics)).await;
    let _ = write_json(&state.paths.ping_json, &snapshot);
    snapshot
}

fn spawn_observability_loop(state: Arc<AppState>) {
    tokio::spawn(async move {
        run_observability_cycle(&state).await;
        loop {
            sleep(Duration::from_secs(60)).await;
            run_observability_cycle(&state).await;
        }
    });
}

async fn run_observability_cycle(state: &AppState) {
    let registration = register_device_response(state).await;
    if let Some(error) = registration.remote_error {
        append_server_log(
            &state.paths,
            &format!("device registration failed: {error}"),
        );
    }

    let flags = feature_flags_response(state).await;
    if let Some(error) = flags.remote_error {
        append_server_log(&state.paths, &format!("feature flag check failed: {error}"));
    }

    let sync = sync_now_response(state).await;
    if let Some(error) = sync.remote_error {
        append_server_log(&state.paths, &format!("ping failed: {error}"));
    }

    let updates = check_updates_response(state).await;
    if let Some(error) = updates.error {
        append_server_log(&state.paths, &format!("version check failed: {error}"));
    }

    let flush = telemetry_flush_response(state).await;
    if let Some(error) = flush.remote_error {
        append_server_log(&state.paths, &format!("telemetry flush failed: {error}"));
    }
}

async fn check_updates_response(state: &AppState) -> UpdateSnapshot {
    let checked_at = now_string();
    let manifest_url = format!(
        "{}/v1/squad/releases/{}/manifest?clientType=squad&surface=squad-daemon&deviceId={}&version={}",
        state.config.api_base_url.trim_end_matches('/'),
        state.config.update_channel,
        state.device_id,
        VERSION
    );
    let api = ApiClient::new(state.config.clone(), state.device_id.clone());
    let result = match api.get_release_manifest().await {
        Ok((_status, payload, url)) => {
            let latest = payload
                .get("latestAllowedVersion")
                .or_else(|| payload.get("latest_allowed_version"))
                .or_else(|| payload.get("version"))
                .and_then(|value| value.as_str())
                .map(ToString::to_string);
            UpdateSnapshot {
                success: true,
                checked_at,
                channel: state.config.update_channel.clone(),
                client_type: "squad".to_string(),
                surface: "squad-daemon".to_string(),
                device_id: state.device_id.clone(),
                current_version: VERSION.to_string(),
                update_available: latest.as_deref().is_some_and(|version| version != VERSION),
                latest_allowed_version: latest,
                manifest_url: url,
                error: None,
            }
        }
        Err(error) => UpdateSnapshot {
            success: false,
            checked_at,
            channel: state.config.update_channel.clone(),
            client_type: "squad".to_string(),
            surface: "squad-daemon".to_string(),
            device_id: state.device_id.clone(),
            current_version: VERSION.to_string(),
            latest_allowed_version: None,
            update_available: false,
            manifest_url,
            error: Some(error.to_string()),
        },
    };
    let _ = write_json(&state.paths.update_json, &result);
    record_daemon_event(
        state,
        "update.checked",
        json!({
            "channel": result.channel,
            "currentVersion": result.current_version,
            "latestAllowedVersion": result.latest_allowed_version,
            "updateAvailable": result.update_available,
            "error": result.error
        }),
    );
    result
}

fn restart_response(state: &AppState) -> (u16, LifecycleResponse) {
    state.accepting_work.store(false, Ordering::SeqCst);
    record_daemon_event(
        state,
        "daemon.restart_requested",
        json!({ "activeRuns": active_run_count(&state.paths) }),
    );
    if let Ok(Some(mut record)) = read_daemon_record(&state.paths) {
        record.accepting_work = false;
        record.drain_requested_at = Some(now_string());
        let _ = write_daemon_record(&state.paths, &record);
    }

    let shutdown_tx = state.shutdown_tx.clone();
    let paths = state.paths.clone();
    tokio::spawn(async move {
        loop {
            if active_run_count(&paths) == 0 {
                break;
            }
            sleep(Duration::from_millis(250)).await;
        }
        if let Some(tx) = shutdown_tx.lock().await.take() {
            let _ = tx.send(());
        }
    });

    (
        202,
        LifecycleResponse {
            success: true,
            message: "drain requested; daemon will stop accepting new work before restart"
                .to_string(),
        },
    )
}

async fn stop_response(state: &AppState) -> LifecycleResponse {
    state.accepting_work.store(false, Ordering::SeqCst);
    record_daemon_event(
        state,
        "daemon.stop_requested",
        json!({ "activeRuns": active_run_count(&state.paths) }),
    );
    if let Some(tx) = state.shutdown_tx.lock().await.take() {
        let _ = tx.send(());
    }
    LifecycleResponse {
        success: true,
        message: "daemon stopping".to_string(),
    }
}

// Persist the channel/thread snapshot proxied from the web server so channel
// orchestration metadata survives web reloads and daemon restarts.
fn channels_sync_response(state: &AppState, mut input: ChannelsState) -> (u16, ChannelsState) {
    input.updated_at = Some(now_string());
    if let Err(error) = write_channels_state(&state.paths, &input) {
        append_server_log(&state.paths, &format!("channels write failed: {error:#}"));
        return (503, input);
    }
    record_daemon_event(
        state,
        "channels.synced",
        json!({
            "channels": input.channels.len(),
            "threads": input.threads.len(),
        }),
    );
    (200, input)
}

fn status_payload(state: &AppState) -> StatusResponse {
    let daemon = read_daemon_record(&state.paths).ok().flatten();
    let metrics = daemon_metrics(state);
    let channels_state = read_channels_state(&state.paths)
        .ok()
        .flatten()
        .unwrap_or_default();
    StatusResponse {
        success: true,
        service: "autohand-squad-daemon".to_string(),
        version: VERSION.to_string(),
        url: state.config.base_url(),
        state_dir: state.paths.root.display().to_string(),
        device_id: state.device_id.clone(),
        accepting_work: state.accepting_work.load(Ordering::SeqCst),
        queue_depth: metrics.queue_depth,
        active_runs: metrics.active_runs,
        running_sessions: metrics.running_sessions,
        active_trigger_work: metrics.active_trigger_work,
        account: AccountState {
            email: current_account_email(state),
            plan_state: state.config.plan_state.clone(),
        },
        online_members: metrics.online_members,
        working_agents: metrics.working_agents,
        queued_jobs: metrics.queued_jobs,
        scheduled_jobs: metrics.scheduled_jobs,
        channels: channels_state.channels.len(),
        channel_threads: channels_state.threads.len(),
        members: metrics.members,
        jobs: metrics.jobs,
        automations: metrics.automations,
        launch_at_login_policy: state.config.launch_at_login_policy.clone(),
        telemetry_policy: state.config.telemetry_policy.clone(),
        last_device_registration_at: read_timestamp_field(
            &state.paths.device_registration_json,
            "registeredAt",
        ),
        last_ping_at: read_timestamp_field(&state.paths.ping_json, "pingedAt"),
        last_feature_flag_check_at: read_timestamp_field(
            &state.paths.feature_flags_json,
            "checkedAt",
        ),
        last_telemetry_flush_at: read_timestamp_field(
            &state.paths.telemetry_flush_json,
            "flushedAt",
        ),
        last_sync_at: read_timestamp_field(&state.paths.sync_json, "syncedAt"),
        last_update_check_at: read_timestamp_field(&state.paths.update_json, "checkedAt"),
        daemon,
    }
}

fn current_account_email(state: &AppState) -> Option<String> {
    state
        .account_email
        .lock()
        .ok()
        .and_then(|account_email| account_email.as_deref().and_then(normalize_account_email))
}

fn normalize_account_email(email: &str) -> Option<String> {
    let trimmed = email.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

struct DaemonMetrics {
    queue_depth: usize,
    queued_jobs: usize,
    scheduled_jobs: usize,
    active_runs: usize,
    running_sessions: usize,
    active_trigger_work: usize,
    working_agents: usize,
    online_members: usize,
    run_count: usize,
    members: Vec<LiveStatusMember>,
    jobs: Vec<LiveStatusJob>,
    automations: Vec<LiveStatusAutomation>,
}

fn daemon_metrics(state: &AppState) -> DaemonMetrics {
    let queue = read_queue_items(&state.paths).unwrap_or_default();
    let runs = read_run_records(&state.paths).unwrap_or_default();
    let live_status = read_fresh_live_status_snapshot(&state.paths);
    let active_runs: Vec<&RunRecord> = runs.iter().filter(|run| run_is_active(run)).collect();
    let agent_ids = active_runs
        .iter()
        .filter_map(|run| run.agent_id.as_deref())
        .filter(|agent_id| !agent_id.trim().is_empty())
        .collect::<HashSet<_>>();
    let active_count = active_runs.len();
    let agent_count = agent_ids.len();
    let live = live_status.as_ref();
    let live_queue_depth = live.map(|snapshot| snapshot.queue_depth).unwrap_or(0);
    let live_queued_jobs = live.map(|snapshot| snapshot.queued_jobs).unwrap_or(0);
    let live_scheduled_jobs = live.map(|snapshot| snapshot.scheduled_jobs).unwrap_or(0);
    let live_active_work = live.map(|snapshot| snapshot.active_work).unwrap_or(0);
    let live_online_members = live.map(|snapshot| snapshot.online_members).unwrap_or(0);
    let live_working_agents = live.map(|snapshot| snapshot.working_agents).unwrap_or(0);
    let live_run_count = live.map(|snapshot| snapshot.total_runs).unwrap_or(0);
    let live_members = live
        .map(|snapshot| snapshot.members.clone())
        .unwrap_or_default();
    let live_jobs = live
        .map(|snapshot| snapshot.jobs.clone())
        .unwrap_or_default();
    let live_automations = live
        .map(|snapshot| snapshot.automations.clone())
        .unwrap_or_default();
    let queued_jobs = queue.iter().filter(|item| item.status == "queued").count();
    let running_queue_jobs = queue.iter().filter(|item| item.status == "running").count();
    let scheduled_jobs = queue
        .iter()
        .filter(|item| item.scheduled_for.is_some())
        .count();
    let active_trigger_work = running_queue_jobs + live_active_work;
    let working_agents = agent_count.max(active_count).max(live_working_agents);
    let online_members = agent_count.max(active_count).max(live_online_members);

    DaemonMetrics {
        queue_depth: queue.len() + live_queue_depth,
        queued_jobs: queued_jobs + live_queued_jobs,
        scheduled_jobs: scheduled_jobs + live_scheduled_jobs,
        active_runs: active_count + active_trigger_work,
        running_sessions: active_count,
        active_trigger_work,
        working_agents,
        online_members,
        run_count: runs.len() + live_run_count,
        members: live_members,
        jobs: live_jobs,
        automations: live_automations,
    }
}

fn remote_metrics(metrics: DaemonMetrics) -> RemoteMetrics {
    RemoteMetrics {
        queue_depth: metrics.queue_depth,
        queued_jobs: metrics.queued_jobs,
        scheduled_jobs: metrics.scheduled_jobs,
        active_work: metrics.active_runs,
        online_members: metrics.online_members,
        working_agents: metrics.working_agents,
        run_count: metrics.run_count,
    }
}

fn record_daemon_event(state: &AppState, event: &str, metadata: serde_json::Value) {
    if state.config.telemetry_enabled() {
        let _ = append_telemetry_event(
            &state.paths,
            daemon_event(event, &state.device_id, Some(metadata)),
        );
    }
}

fn active_run_count(paths: &StatePaths) -> usize {
    read_run_records(paths)
        .map(|runs| runs.iter().filter(|run| run_is_active(run)).count())
        .unwrap_or(0)
}

fn run_is_active(run: &RunRecord) -> bool {
    run.status == "queued" || run.status == "running"
}

pub fn read_queue_items(paths: &StatePaths) -> Result<Vec<QueueItem>> {
    paths.ensure()?;
    let mut items = Vec::new();
    for entry in fs::read_dir(&paths.queue_dir)
        .with_context(|| format!("read {}", paths.queue_dir.display()))?
    {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let content =
            fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
        let parsed = serde_json::from_str::<serde_json::Value>(&content).unwrap_or_default();
        let id = parsed
            .get("id")
            .and_then(|value| value.as_str())
            .map(ToString::to_string)
            .or_else(|| {
                path.file_stem()
                    .and_then(|value| value.to_str())
                    .map(ToString::to_string)
            })
            .unwrap_or_else(|| "queue-item".to_string());
        let status = parsed
            .get("status")
            .and_then(|value| value.as_str())
            .unwrap_or("queued")
            .to_string();
        let prompt = parsed
            .get("prompt")
            .and_then(|value| value.as_str())
            .map(ToString::to_string);
        let created_at = parsed
            .get("createdAt")
            .or_else(|| parsed.get("created_at"))
            .and_then(|value| value.as_str())
            .map(ToString::to_string);
        items.push(QueueItem {
            id,
            status,
            prompt,
            created_at,
            scheduled_for: parsed
                .get("scheduledFor")
                .or_else(|| parsed.get("scheduled_for"))
                .and_then(|value| value.as_str())
                .map(ToString::to_string),
            workspace: parsed
                .get("workspace")
                .and_then(|value| value.as_str())
                .map(ToString::to_string),
            channel_id: parsed
                .get("channelId")
                .or_else(|| parsed.get("channel_id"))
                .and_then(|value| value.as_str())
                .map(ToString::to_string),
            thread_id: parsed
                .get("threadId")
                .or_else(|| parsed.get("thread_id"))
                .and_then(|value| value.as_str())
                .map(ToString::to_string),
        });
    }
    items.sort_by(|a, b| {
        a.created_at
            .cmp(&b.created_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(items)
}

fn write_queue_item(paths: &StatePaths, item: &QueueItem) -> Result<()> {
    paths.ensure()?;
    let path = paths.queue_dir.join(format!("{}.json", item.id));
    write_json(&path, item)
}

fn new_run_record(paths: &StatePaths, request: RunRequest, status: &str) -> RunRecord {
    let id = next_id();
    let autohand_bin =
        std::env::var("AUTOHAND_SQUAD_AUTOHAND_BIN").unwrap_or_else(|_| "autohand".to_string());
    let mut command = vec![autohand_bin, "--prompt".to_string(), request.prompt.clone()];
    if let Some(workspace) = &request.workspace {
        command.push("--path".to_string());
        command.push(workspace.clone());
    }
    if let Some(extra_args) = &request.extra_args {
        command.extend(extra_args.clone());
    }
    RunRecord {
        id: id.clone(),
        status: status.to_string(),
        prompt: request.prompt,
        workspace: request.workspace,
        agent_id: request.agent_id,
        command,
        log_path: paths
            .runs_dir
            .join(format!("{id}.log"))
            .display()
            .to_string(),
        created_at: now_string(),
        started_at: None,
        completed_at: None,
        exit_code: None,
        channel_id: request.channel_id,
        thread_id: request.thread_id,
    }
}

fn next_id() -> String {
    let sequence = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    let timestamp = now_string().replace(':', "-");
    format!("{timestamp}-{sequence}")
}

fn spawn_run_worker(
    paths: StatePaths,
    mut record: RunRecord,
    device_id: String,
    telemetry_enabled: bool,
) {
    tokio::spawn(async move {
        record.status = "running".to_string();
        record.started_at = Some(now_string());
        let _ = write_run_record(&paths, &record);
        append_server_log(&paths, &format!("run {} started", record.id));
        if telemetry_enabled {
            let _ = append_telemetry_event(
                &paths,
                daemon_event(
                    "active_work.started",
                    &device_id,
                    Some(json!({
                        "id": record.id,
                        "agentId": record.agent_id,
                        "workspace": record.workspace
                    })),
                ),
            );
        }

        let log_path = PathBuf::from(&record.log_path);
        let mut command = Command::new(&record.command[0]);
        command.args(&record.command[1..]);
        if let Some(workspace) = &record.workspace {
            command.current_dir(workspace);
        }
        let output = command.output().await;

        match output {
            Ok(output) => {
                let mut combined = Vec::new();
                combined.extend(output.stdout);
                combined.extend(output.stderr);
                let _ = tokio::fs::write(&log_path, combined).await;
                record.exit_code = output.status.code();
                record.status = if output.status.success() {
                    "completed".to_string()
                } else {
                    "failed".to_string()
                };
            }
            Err(error) => {
                let _ = tokio::fs::write(&log_path, error.to_string()).await;
                record.status = "failed".to_string();
                record.exit_code = None;
            }
        }

        record.completed_at = Some(now_string());
        let _ = write_run_record(&paths, &record);
        append_server_log(&paths, &format!("run {} {}", record.id, record.status));
        if telemetry_enabled {
            let event = if record.status == "completed" {
                "queue.completed"
            } else {
                "queue.failed"
            };
            let _ = append_telemetry_event(
                &paths,
                daemon_event(
                    event,
                    &device_id,
                    Some(json!({
                        "id": record.id,
                        "status": record.status,
                        "agentId": record.agent_id,
                        "exitCode": record.exit_code
                    })),
                ),
            );
            if record.status == "failed" {
                let _ = append_telemetry_event(
                    &paths,
                    daemon_event(
                        "error",
                        &device_id,
                        Some(json!({
                            "source": "squad-daemon",
                            "runId": record.id,
                            "exitCode": record.exit_code
                        })),
                    ),
                );
            }
        }
    });
}

fn read_run_records(paths: &StatePaths) -> Result<Vec<RunRecord>> {
    paths.ensure()?;
    let mut runs = Vec::new();
    for entry in fs::read_dir(&paths.runs_dir)
        .with_context(|| format!("read {}", paths.runs_dir.display()))?
    {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let content =
            fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
        if let Ok(record) = serde_json::from_str::<RunRecord>(&content) {
            runs.push(record);
        }
    }
    runs.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(runs)
}

fn read_run_record(paths: &StatePaths, id: &str) -> Result<Option<RunRecord>> {
    let path = paths.runs_dir.join(format!("{id}.json"));
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
    let record =
        serde_json::from_str(&content).with_context(|| format!("parse {}", path.display()))?;
    Ok(Some(record))
}

fn write_run_record(paths: &StatePaths, record: &RunRecord) -> Result<()> {
    paths.ensure()?;
    write_json(&paths.runs_dir.join(format!("{}.json", record.id)), record)
}

fn append_server_log(paths: &StatePaths, message: &str) {
    let _ = paths.ensure();
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.server_log)
    {
        let _ = writeln!(file, "{} {}", now_string(), message);
    }
}

fn read_telemetry_events(paths: &StatePaths, limit: usize) -> Vec<TelemetryEvent> {
    let content = fs::read_to_string(&paths.telemetry_log).unwrap_or_default();
    content
        .lines()
        .rev()
        .take(limit)
        .filter_map(|line| serde_json::from_str::<TelemetryEvent>(line).ok())
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect()
}

fn write_json<T: Serialize>(path: &PathBuf, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;
    }
    let content = serde_json::to_string_pretty(value)?;
    fs::write(path, format!("{content}\n")).with_context(|| format!("write {}", path.display()))?;
    Ok(())
}

fn read_timestamp_field(path: &PathBuf, field: &str) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    let value = serde_json::from_str::<serde_json::Value>(&content).ok()?;
    value.get(field)?.as_str().map(ToString::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::PartialSquadConfig;
    use crate::state::StatePaths;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;
    use tokio::time::{sleep, Duration};

    static TEST_DIR_ID: AtomicU64 = AtomicU64::new(1);

    fn temp_state_paths() -> StatePaths {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let sequence = TEST_DIR_ID.fetch_add(1, Ordering::SeqCst);
        StatePaths::from_root(std::env::temp_dir().join(format!(
            "autohand-squad-daemon-test-{}-{nonce}-{sequence}",
            std::process::id()
        )))
    }

    #[test]
    fn generated_ids_are_safe_as_cross_platform_file_names() {
        let id = next_id();

        assert!(id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_')));
        assert!(!id.chars().any(|character| matches!(
            character,
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
        )));
    }

    #[test]
    fn reads_queue_items_from_state_directory() {
        let paths = temp_state_paths();
        paths.ensure().unwrap();
        fs::write(
            paths.queue_dir.join("task-1.json"),
            r#"{"id":"task-1","status":"queued","prompt":"ship it","createdAt":"2026-01-01T00:00:00Z"}"#,
        )
        .unwrap();

        let items = read_queue_items(&paths).unwrap();

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "task-1");
        assert_eq!(items[0].status, "queued");
        assert_eq!(items[0].prompt.as_deref(), Some("ship it"));
        assert_eq!(items[0].scheduled_for, None);
        assert_eq!(items[0].workspace, None);
        let _ = fs::remove_dir_all(paths.root);
    }

    #[test]
    fn persists_run_records_and_status_counts_active_runs() {
        let paths = temp_state_paths();
        paths.ensure().unwrap();
        let record = new_run_record(
            &paths,
            RunRequest {
                prompt: "check status".to_string(),
                workspace: Some(paths.root.display().to_string()),
                agent_id: Some("agent-1".to_string()),
                extra_args: Some(vec!["--dry-run".to_string()]),
                channel_id: None,
                thread_id: None,
            },
            "running",
        );
        write_run_record(&paths, &record).unwrap();

        let state = AppState {
            paths: paths.clone(),
            account_email: Arc::new(StdMutex::new(None)),
            config: SquadConfig::defaults(),
            accepting_work: Arc::new(AtomicBool::new(true)),
            shutdown_tx: Arc::new(Mutex::new(None)),
            device_id: "device-1".to_string(),
        };
        let status = status_payload(&state);

        assert_eq!(read_run_records(&paths).unwrap().len(), 1);
        assert_eq!(status.active_runs, 1);
        assert_eq!(status.running_sessions, 1);
        assert_eq!(status.active_trigger_work, 0);
        assert_eq!(status.queue_depth, 0);
        let _ = fs::remove_dir_all(paths.root);
    }

    #[test]
    fn status_counts_live_web_snapshot_members_and_progress() {
        let paths = temp_state_paths();
        paths.ensure().unwrap();
        fs::write(
            &paths.web_status_json,
            r#"{"source":"web-console","updatedAt":"2026-05-27T00:00:00Z","onlineMembers":5,"workingAgents":2,"queuedJobs":1,"scheduledJobs":3,"activeWork":2,"queueDepth":1,"totalRuns":4,"members":[{"id":"asq_1","name":"Eva","role":"QA","status":"online","working":true,"queuedJobs":1,"scheduledJobs":0}],"jobs":[{"id":"job_1","title":"Ship check","status":"queued","agentId":"asq_1","agentName":"Eva"}],"automations":[{"id":"auto_1","name":"Daily triage","status":"active","agentId":"asq_1","agentName":"Eva","triggerType":"schedule"}]}"#,
        )
        .unwrap();

        let state = AppState {
            paths: paths.clone(),
            account_email: Arc::new(StdMutex::new(None)),
            config: SquadConfig::defaults(),
            accepting_work: Arc::new(AtomicBool::new(true)),
            shutdown_tx: Arc::new(Mutex::new(None)),
            device_id: "device-1".to_string(),
        };
        let status = status_payload(&state);

        assert_eq!(status.online_members, 5);
        assert_eq!(status.working_agents, 2);
        assert_eq!(status.active_runs, 2);
        assert_eq!(status.running_sessions, 0);
        assert_eq!(status.active_trigger_work, 2);
        assert_eq!(status.queue_depth, 1);
        assert_eq!(status.queued_jobs, 1);
        assert_eq!(status.scheduled_jobs, 3);
        assert_eq!(status.members[0].name, "Eva");
        assert_eq!(status.jobs[0].title, "Ship check");
        assert_eq!(status.automations[0].name, "Daily triage");
        let _ = fs::remove_dir_all(paths.root);
    }

    #[test]
    fn login_and_logout_update_local_account_state() {
        let paths = temp_state_paths();
        let state = AppState {
            paths: paths.clone(),
            account_email: Arc::new(StdMutex::new(None)),
            config: SquadConfig::defaults(),
            accepting_work: Arc::new(AtomicBool::new(true)),
            shutdown_tx: Arc::new(Mutex::new(None)),
            device_id: "device-1".to_string(),
        };

        let (status, login) = login_response(
            &state,
            LoginRequest {
                email: " ops@example.com ".to_string(),
            },
        );
        assert_eq!(status, 200);
        assert!(login.success);
        assert_eq!(
            status_payload(&state).account.email.as_deref(),
            Some("ops@example.com")
        );

        let logout = logout_response(&state);
        assert!(logout.success);
        assert_eq!(status_payload(&state).account.email, None);
        let _ = fs::remove_dir_all(paths.root);
    }

    #[test]
    fn appends_telemetry_events_as_jsonl() {
        let paths = temp_state_paths();
        append_telemetry_event(
            &paths,
            TelemetryEvent {
                event: "test.event".to_string(),
                timestamp: None,
                client_type: Some("squad".to_string()),
                surface: Some("squad-daemon".to_string()),
                version: None,
                device_id: Some("device-1".to_string()),
                metadata: Some(json!({ "ok": true })),
            },
        )
        .unwrap();

        let content = fs::read_to_string(paths.telemetry_log).unwrap();
        assert!(content.contains("\"event\":\"test.event\""));
        assert!(content.contains("\"clientType\":\"squad\""));
        assert!(content.contains("\"ok\":true"));
        let _ = fs::remove_dir_all(paths.root);
    }

    #[tokio::test]
    async fn daemon_serves_status_queue_sync_and_drain_restart() {
        let paths = temp_state_paths();
        let daemon_paths = paths.clone();
        let mut handle = tokio::spawn(async move {
            run_daemon_with_paths(
                daemon_paths,
                PartialSquadConfig {
                    host: Some("127.0.0.1".to_string()),
                    port: Some(0),
                    api_base_url: Some("mock://offline".to_string()),
                    ..PartialSquadConfig::default()
                },
            )
            .await
        });

        let record = tokio::select! {
            result = &mut handle => panic!("daemon exited before writing its record: {result:?}"),
            record = wait_for_daemon_record(&paths) => record,
        };
        let status: StatusResponse = local_json_request(&record, "GET", "/status", None)
            .await
            .unwrap();
        assert!(status.success);
        assert!(status.accepting_work);

        let queued: QueueItem = local_json_request(
            &record,
            "POST",
            "/queue",
            Some(
                &serde_json::to_string(&EnqueueRequest {
                    prompt: "ship it".to_string(),
                    workspace: Some(paths.root.display().to_string()),
                    scheduled_for: Some("2026-05-25T00:00:00Z".to_string()),
                    channel_id: Some("channel_general".to_string()),
                    thread_id: Some("thread_1".to_string()),
                })
                .unwrap(),
            ),
        )
        .await
        .unwrap();
        assert_eq!(queued.status, "queued");
        assert_eq!(queued.channel_id.as_deref(), Some("channel_general"));
        assert_eq!(queued.thread_id.as_deref(), Some("thread_1"));

        let synced: ChannelsState = local_json_request(
            &record,
            "PUT",
            "/channels",
            Some(
                r#"{
                    "channels": [{ "id": "channel_general", "name": "general", "memberIds": ["agent-1"] }],
                    "threads": [{ "id": "thread_1", "channelId": "channel_general", "title": "ship it" }]
                }"#,
            ),
        )
        .await
        .unwrap();
        assert_eq!(synced.channels.len(), 1);

        let channels: ChannelsState = local_json_request(&record, "GET", "/channels", None)
            .await
            .unwrap();
        assert_eq!(channels.channels[0].id, "channel_general");
        assert_eq!(channels.channels[0].visibility, "public");
        assert!(!channels.channels[0].auto_mode_default);
        assert_eq!(channels.threads.len(), 1);

        let status_with_channels: StatusResponse =
            local_json_request(&record, "GET", "/status", None)
                .await
                .unwrap();
        assert_eq!(status_with_channels.channels, 1);
        assert_eq!(status_with_channels.channel_threads, 1);

        let sync: SyncSnapshot = local_json_request(&record, "POST", "/sync", Some(""))
            .await
            .unwrap();
        assert!(sync.success);
        assert_eq!(sync.queue_depth, 1);

        let mut active_record = new_run_record(
            &paths,
            RunRequest {
                prompt: "finish before restart".to_string(),
                workspace: Some(paths.root.display().to_string()),
                agent_id: Some("agent-1".to_string()),
                extra_args: None,
                channel_id: None,
                thread_id: None,
            },
            "running",
        );
        write_run_record(&paths, &active_record).unwrap();

        let restart: LifecycleResponse = local_json_request(&record, "POST", "/restart", Some(""))
            .await
            .unwrap();
        assert!(restart.success);
        sleep(Duration::from_millis(300)).await;

        let draining: StatusResponse = local_json_request(&record, "GET", "/status", None)
            .await
            .unwrap();
        assert!(!draining.accepting_work);
        assert_eq!(draining.active_runs, 1);

        active_record.status = "completed".to_string();
        active_record.completed_at = Some(now_string());
        write_run_record(&paths, &active_record).unwrap();

        let result = handle.await.unwrap();
        assert!(result.is_ok());
        let _ = fs::remove_dir_all(paths.root);
    }

    async fn wait_for_daemon_record(paths: &StatePaths) -> DaemonRecord {
        // Native CI runners can spend more than a second scheduling the loopback task
        // while the rest of the test binary is active.
        for _ in 0..250 {
            if let Ok(Some(record)) = read_daemon_record(paths) {
                return record;
            }
            sleep(Duration::from_millis(20)).await;
        }
        panic!("daemon record was not written");
    }

    async fn local_json_request<T>(
        record: &DaemonRecord,
        method: &str,
        path: &str,
        body: Option<&str>,
    ) -> Result<T>
    where
        T: DeserializeOwned,
    {
        let mut stream = TcpStream::connect((record.host.as_str(), record.port)).await?;
        let body = body.unwrap_or("");
        let request = format!(
            "{method} {path} HTTP/1.1\r\nHost: {}:{}\r\nAccept: application/json\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            record.host,
            record.port,
            body.len(),
            body
        );
        stream.write_all(request.as_bytes()).await?;
        let mut response = String::new();
        stream.read_to_string(&mut response).await?;
        let (_headers, body) = response
            .split_once("\r\n\r\n")
            .ok_or_else(|| anyhow::anyhow!("invalid HTTP response"))?;
        Ok(serde_json::from_str(body)?)
    }
}
