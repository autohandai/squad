use crate::api::{ApiClient, RemoteMetrics, TelemetryFlushSnapshot};
use crate::cli::{process_is_running, spawn_web_server, terminate_process, web_runtime_is_ready};
use crate::config::{resolve_config, ConfigOverrides, SquadConfig};
use crate::live_status::{
    read_fresh_live_status_snapshot, LiveStatusAutomation, LiveStatusJob, LiveStatusMember,
};
use crate::ownership::{read_active_context, still_current, OwnedContext};
use crate::ownership_activity::{OwnedActivity, OwnershipActivity};
use crate::state::{
    default_state_paths, ensure_device_id, now_string, read_channels_state, read_daemon_record,
    read_web_server_record, remove_daemon_record, write_daemon_record, ChannelsState, DaemonRecord,
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
use std::path::{Path, PathBuf};
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
pub struct StatusOwnership {
    pub generation: String,
    pub owner_key: String,
    pub dataset_id: String,
}
impl StatusOwnership {
    pub fn matches(&self, context: &OwnedContext) -> bool {
        self.generation == context.generation
            && self.owner_key == context.owner_key
            && self.dataset_id == context.dataset_id
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StatusResponse {
    pub success: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ownership: Option<StatusOwnership>,
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
    /// How many times this daemon has restarted the web bridge (ADR-0123).
    #[serde(default)]
    pub web_server_restarts: u64,
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
    /// Execution harness: `autohand` (default), `codex`, or `claude`.
    #[serde(default)]
    pub harness: Option<String>,
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
    #[serde(default = "default_harness_id")]
    pub harness: String,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub daemon_instance_id: Option<String>,
    /// Read projection only. The persisted execution history is not rewritten.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery_status: Option<String>,
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
    /// Where the release lives (GitHub release page) and the installer for this
    /// platform, when the GitHub source produced them.
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub release_url: Option<String>,
    #[serde(default)]
    pub download_url: Option<String>,
    #[serde(default)]
    pub download_name: Option<String>,
    #[serde(default)]
    pub download_sha256: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Clone)]
struct AppState {
    paths: StatePaths,
    config: SquadConfig,
    account_email: Arc<StdMutex<Option<String>>>,
    accepting_work: Arc<AtomicBool>,
    update_admission: Arc<StdMutex<Option<String>>>,
    ownership_activity: Arc<OwnershipActivity>,
    instance_id: String,
    native_recovery_confirmed: bool,
    shutdown_tx: Arc<Mutex<Option<oneshot::Sender<()>>>>,
    device_id: String,
    web_restarts: Arc<AtomicU64>,
}

pub async fn run_daemon(overrides: ConfigOverrides) -> Result<()> {
    let paths = default_state_paths();
    run_daemon_with_paths(paths, overrides).await
}

pub async fn run_daemon_with_paths(paths: StatePaths, overrides: ConfigOverrides) -> Result<()> {
    paths.ensure()?;
    let mut lease_options = fs::OpenOptions::new();
    lease_options.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        lease_options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let _daemon_lease = lease_options.open(paths.root.join("daemon-writer.lock"))?;
    if !_daemon_lease.metadata()?.is_file() {
        bail!("Invalid native service lock");
    }
    _daemon_lease
        .try_lock()
        .context("Another native Squad service already owns this directory")?;
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

    let activity = Arc::new(OwnershipActivity::default());
    let native_recovery_confirmed = !crate::native_work_intents::unresolved(&paths)?;
    if !native_recovery_confirmed {
        activity.uncertain_cleanup();
    }
    let accepting = !activity.is_paused();
    let record = DaemonRecord {
        pid: std::process::id(),
        host: config.host.clone(),
        port: local_addr.port(),
        url: url.clone(),
        accepting_work: accepting,
        started_at: now_string(),
        drain_requested_at: None,
    };
    write_daemon_record(&paths, &record)?;

    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
    let state = Arc::new(AppState {
        paths: paths.clone(),
        account_email: Arc::new(StdMutex::new(config.account_email.clone())),
        config,
        accepting_work: Arc::new(AtomicBool::new(accepting)),
        update_admission: Arc::new(StdMutex::new(None)),
        ownership_activity: activity,
        instance_id: format!("{}:{}", record.pid, record.started_at),
        native_recovery_confirmed,
        shutdown_tx: Arc::new(Mutex::new(Some(shutdown_tx))),
        device_id,
        web_restarts: Arc::new(AtomicU64::new(0)),
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
    spawn_bridge_supervisor(state.clone());

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

    state.ownership_activity.stop();
    while state.ownership_activity.active() > 0 {
        sleep(Duration::from_millis(25)).await;
    }
    remove_daemon_record(&paths)?;
    Ok(())
}

#[derive(Debug)]
struct HttpRequest {
    method: String,
    path: String,
    body: String,
    /// Present when a browser sent the request cross-site; the loopback API
    /// only serves same-machine callers without an Origin.
    origin: Option<String>,
    ownership_context: Option<String>,
    ownership_control: Option<String>,
}

async fn handle_connection(mut stream: TcpStream, state: Arc<AppState>) -> Result<()> {
    let request = read_http_request(&mut stream).await?;
    if let Some(origin) = request.origin.as_deref() {
        if !origin_is_loopback(origin) {
            return write_json_response(
                &mut stream,
                403,
                &LifecycleResponse {
                    success: false,
                    message: "cross-origin requests to the local daemon are not allowed"
                        .to_string(),
                },
            )
            .await;
        }
    }
    route_request(&mut stream, &state, request).await
}

fn origin_is_loopback(origin: &str) -> bool {
    let lower = origin.trim().to_ascii_lowercase();
    let Some(rest) = lower
        .strip_prefix("http://")
        .or_else(|| lower.strip_prefix("https://"))
    else {
        return false;
    };
    let host = rest.split('/').next().unwrap_or(rest);
    let host = if let Some(inner) = host.strip_prefix('[') {
        inner.split(']').next().unwrap_or("")
    } else {
        host.split(':').next().unwrap_or("")
    };
    matches!(host, "127.0.0.1" | "localhost" | "::1")
}

fn parse_origin(headers: &str) -> Option<String> {
    headers.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if name.trim().eq_ignore_ascii_case("origin") {
            Some(value.trim().to_string())
        } else {
            None
        }
    })
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

    Ok(HttpRequest {
        method,
        path,
        body,
        origin: parse_origin(&headers),
        ownership_context: headers.lines().find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.trim()
                .eq_ignore_ascii_case("x-squad-context")
                .then(|| value.trim().to_string())
        }),
        ownership_control: headers.lines().find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.trim()
                .eq_ignore_ascii_case("x-squad-ownership-control")
                .then(|| value.trim().to_string())
        }),
    })
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
    if request.path.starts_with("/ownership/") {
        return ownership_control_response(stream, state, &request).await;
    }
    let owned = read_active_context(&state.paths).ok().flatten();
    let private = request.path == "/queue"
        || request.path == "/runs"
        || request.path.starts_with("/runs/")
        || request.path == "/channels"
        || request.path == "/logs";
    let private = private
        || matches!(
            request.path.as_str(),
            "/sync" | "/heartbeat" | "/telemetry" | "/telemetry/flush"
        );
    let matching = owned.as_ref().is_some_and(|context| {
        request.ownership_context.as_deref() == Some(context.generation.as_str())
            && read_daemon_record(&state.paths)
                .ok()
                .flatten()
                .is_some_and(|daemon| {
                    format!("{}:{}", daemon.pid, daemon.started_at) == state.instance_id
                })
    });
    if private
        && (!matching
            || (!matches!(request.method.as_str(), "GET" | "HEAD")
                && !owned.as_ref().is_some_and(|context| context.can_write)))
    {
        return write_json_response(stream, if matching {403} else {409}, &LifecycleResponse { success: false, message: "The selected Squad changed or cannot perform this operation. Reconnect with its current context.".into() }).await;
    }
    let _activity = if private {
        let guard = state.ownership_activity.begin(|| {
            matching
                && owned
                    .as_ref()
                    .is_some_and(|context| still_current(&state.paths, context))
        });
        if guard.is_none() {
            return write_json_response(
                stream,
                409,
                &LifecycleResponse {
                    success: false,
                    message: "The selected Squad is draining. Try again after it finishes.".into(),
                },
            )
            .await;
        }
        guard
    } else {
        None
    };
    let data_paths = owned.as_ref().map(|context| &context.data_paths);
    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/health") => write_json_response(stream, 200, &health()).await,
        ("GET", "/status") => {
            write_json_response(
                stream,
                200,
                &status_payload_for_context(state, owned.as_ref().filter(|_| matching)),
            )
            .await
        }
        ("GET", "/queue") => {
            write_json_response(
                stream,
                200,
                &queue_response(data_paths.expect("private route requires context")),
            )
            .await
        }
        ("POST", "/queue") => {
            let input = parse_json_body::<EnqueueRequest>(&request.body)?;
            let (status, item) = enqueue_response(state, input, owned.as_ref());
            write_json_response(stream, status, &item).await
        }
        ("GET", "/channels") => {
            let channels = read_channels_state(data_paths.expect("private route requires context"))
                .ok()
                .flatten()
                .unwrap_or_default();
            write_json_response(stream, 200, &channels).await
        }
        ("POST" | "PUT", "/channels") => {
            let input = parse_json_body::<ChannelsState>(&request.body)?;
            let (status, response) = channels_sync_response(
                state,
                input,
                owned.as_ref().expect("private route requires context"),
            )
            .await;
            write_json_response(stream, status, &response).await
        }
        ("GET", "/config") => {
            let mut config = state.config.clone();
            config.api_auth_token = None;
            config.company_secret = None;
            config.account_email = owned.as_ref().filter(|_| matching).and_then(|context| {
                (!context.actor.email.is_empty()).then(|| context.actor.email.clone())
            });
            write_json_response(stream, 200, &config).await
        }
        ("GET", "/runs") => {
            write_json_response(
                stream,
                200,
                &runs_response(state, data_paths.expect("private route requires context")),
            )
            .await
        }
        ("POST", "/runs") => {
            let input = parse_json_body::<RunRequest>(&request.body)?;
            let (status, record) = start_run_response(state, input, owned.as_ref());
            write_json_response(stream, status, &record).await
        }
        ("GET", "/logs") => {
            write_json_response(
                stream,
                200,
                &server_logs_response(data_paths.expect("private route requires context")),
            )
            .await
        }
        ("POST", "/telemetry") => {
            let event = parse_json_body::<TelemetryEvent>(&request.body)?;
            let response = telemetry_response(
                state,
                event,
                owned.as_ref().expect("private route requires context"),
            );
            write_json_response(stream, 200, &response).await
        }
        ("POST", "/sync") => {
            let response = sync_now_response(state, owned.as_ref()).await;
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
            let response = telemetry_flush_response(state, owned.as_ref()).await;
            write_json_response(stream, 200, &response).await
        }
        ("POST", "/updates/pause" | "/updates/resume") => {
            let input = parse_json_body::<serde_json::Value>(&request.body)?;
            let token = input
                .get("token")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            let (status, response) =
                update_admission_response(state, token, request.path == "/updates/pause");
            write_json_response(stream, status, &response).await
        }
        ("POST", "/updates/check") => {
            let response = check_updates_response(state).await;
            write_json_response(stream, 200, &response).await
        }
        ("POST", "/heartbeat") => {
            let response = heartbeat_response(state, owned.as_ref()).await;
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
            let (status, response) =
                run_logs_response(data_paths.expect("private route requires context"), id);
            write_json_response(stream, status, &response).await
        }
        ("GET", path) if path.starts_with("/runs/") => {
            let id = path.trim_start_matches("/runs/");
            match read_run_record(data_paths.expect("private route requires context"), id)
                .ok()
                .flatten()
            {
                Some(record) => {
                    write_json_response(
                        stream,
                        200,
                        &Some(project_run_record(
                            record,
                            &state.instance_id,
                            state.native_recovery_confirmed,
                        )),
                    )
                    .await
                }
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnershipControl {
    broker_id: String,
    token: String,
}

async fn ownership_control_response(
    stream: &mut TcpStream,
    state: &AppState,
    request: &HttpRequest,
) -> Result<()> {
    let control = crate::ownership::read_private_json::<OwnershipControl>(
        &state.paths.root.join("ownership-control.json"),
        4096,
    )
    .ok();
    let authorized = control.as_ref().is_some_and(|control| {
        control.token.len() == 64 && request.ownership_control.as_deref() == Some(&control.token)
    });
    if !authorized || request.origin.is_some() {
        return write_json_response(
            stream,
            403,
            &json!({"success":false,"error":"The machine ownership capability is required."}),
        )
        .await;
    }
    let control = control.expect("authorized control");
    let daemon =
        read_daemon_record(&state.paths)?.ok_or_else(|| anyhow!("Daemon record unavailable"))?;
    let instance = state.instance_id.clone();
    if format!("{}:{}", daemon.pid, daemon.started_at) != instance {
        return write_json_response(stream, 409, &json!({"success":false,"error":"This listener no longer owns the native service record."})).await;
    }
    if request.method == "GET" && request.path == "/ownership/status" {
        return write_json_response(
            stream,
            200,
            &json!({"success":true,"brokerId":control.broker_id,"instanceId":instance}),
        )
        .await;
    }
    let input: serde_json::Value = parse_json_body(&request.body)?;
    let operation = input
        .get("operationId")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if request.method != "POST"
        || operation.len() != 36
        || !operation
            .bytes()
            .all(|b| b.is_ascii_hexdigit() || b == b'-')
        || input.get("brokerId").and_then(|v| v.as_str()) != Some(&control.broker_id)
        || input.get("instanceId").and_then(|v| v.as_str()) != Some(&instance)
    {
        return write_json_response(stream, 409, &json!({"success":false,"error":"The native ownership operation or daemon instance changed."})).await;
    }
    if request.path == "/ownership/drain" {
        let result = {
            let _admission = state
                .update_admission
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            let result = state.ownership_activity.drain(operation);
            if result.is_ok() {
                state.accepting_work.store(false, Ordering::SeqCst);
            }
            result
        };
        if let Err(error) = result {
            return write_json_response(
                stream,
                409,
                &json!({"success":false,"error":error.to_string()}),
            )
            .await;
        }
        let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
        loop {
            match state.ownership_activity.drained(operation) {
                Ok(true) => return write_json_response(stream, 200, &json!({"success":true,"drained":true,"operationId":operation,"brokerId":control.broker_id,"instanceId":instance})).await,
                Err(error) => return write_json_response(stream, 503, &json!({"success":false,"error":error.to_string()})).await,
                Ok(false) if tokio::time::Instant::now() < deadline => sleep(Duration::from_millis(25)).await,
                Ok(false) => return write_json_response(stream, 503, &json!({"success":false,"error":"Native writers did not drain. Existing data was preserved."})).await,
            }
        }
    }
    if request.path == "/ownership/resume" {
        let result = {
            let update = state
                .update_admission
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            let result = state.ownership_activity.resume(operation);
            if result.is_ok() {
                state.accepting_work.store(
                    update.is_none() && !state.ownership_activity.is_paused(),
                    Ordering::SeqCst,
                );
            }
            result
        };
        return match result {
            Ok(()) => write_json_response(stream, 200, &json!({"success":true,"operationId":operation,"brokerId":control.broker_id,"instanceId":instance})).await,
            Err(error) => write_json_response(stream, 409, &json!({"success":false,"error":error.to_string()})).await,
        };
    }
    write_json_response(
        stream,
        404,
        &json!({"success":false,"error":"Ownership route not found"}),
    )
    .await
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

fn queue_response(paths: &StatePaths) -> QueueResponse {
    QueueResponse {
        success: true,
        items: read_queue_items(paths).unwrap_or_default(),
    }
}

fn enqueue_response(
    state: &AppState,
    request: EnqueueRequest,
    owned: Option<&OwnedContext>,
) -> (u16, QueueItem) {
    let _admission = state
        .update_admission
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
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

    let Some(owned) =
        owned.filter(|context| context.can_write && still_current(&state.paths, context))
    else {
        return (
            403,
            QueueItem {
                id: "rejected".into(),
                status: "rejected".into(),
                prompt: Some(request.prompt),
                created_at: Some(now_string()),
                scheduled_for: request.scheduled_for,
                workspace: request.workspace,
                channel_id: request.channel_id,
                thread_id: request.thread_id,
            },
        );
    };
    let mut item = QueueItem {
        id: next_id(),
        status: "queued".to_string(),
        prompt: Some(request.prompt),
        created_at: Some(now_string()),
        scheduled_for: request.scheduled_for,
        workspace: request.workspace,
        channel_id: request.channel_id,
        thread_id: request.thread_id,
    };
    if let Err(error) = write_queue_item(&owned.data_paths, &item) {
        append_server_log(&owned.data_paths, &format!("queue write failed: {error:#}"));
        item.status = "failed".into();
        return (503, item);
    }
    record_owned_event(
        state,
        owned,
        "queue.created",
        json!({
            "id": item.id,
            "workspace": item.workspace,
            "scheduledFor": item.scheduled_for,
            "channelId": item.channel_id,
            "threadId": item.thread_id,
            "queueDepth": read_queue_items(&owned.data_paths).map(|items| items.len()).unwrap_or(0)
        }),
    );
    (201, item)
}
fn update_admission_response(
    state: &AppState,
    token: &str,
    pause: bool,
) -> (u16, serde_json::Value) {
    if token.len() != 36
        || !token
            .chars()
            .all(|value| value.is_ascii_hexdigit() || value == '-')
    {
        return (
            400,
            json!({"success":false,"error":"Invalid update owner."}),
        );
    }
    let mut owner = state
        .update_admission
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    if !pause {
        if owner.as_deref() != Some(token) {
            return (
                409,
                json!({"success":false,"error":"This update does not own the admission pause."}),
            );
        }
        *owner = None;
        state
            .accepting_work
            .store(!state.ownership_activity.is_paused(), Ordering::SeqCst);
        return (200, json!({"success":true,"paused":false}));
    }
    if !state.accepting_work.load(Ordering::SeqCst) {
        return (
            409,
            json!({"success":false,"error":"The Squad service is already paused or stopping."}),
        );
    }
    // Admission and record creation use this same mutex: no accepted request
    // can slip past the final idle check and be stopped by an installer.
    let owned = read_active_context(&state.paths).ok().flatten();
    if state.ownership_activity.active() > 0
        || owned.as_ref().is_some_and(|context| {
            active_run_count(state, &context.data_paths) > 0
                || read_queue_items(&context.data_paths)
                    .map(|items| {
                        items.iter().any(|item| {
                            ["queued", "pending", "running"].contains(&item.status.as_str())
                        })
                    })
                    .unwrap_or(true)
        })
    {
        return (
            409,
            json!({"success":false,"error":"Finish active and queued daemon work before installing."}),
        );
    }
    state.accepting_work.store(false, Ordering::SeqCst);
    *owner = Some(token.to_string());
    let held = state.update_admission.clone();
    let accepting = state.accepting_work.clone();
    let activity = state.ownership_activity.clone();
    let token = token.to_string();
    tokio::spawn(async move {
        sleep(Duration::from_secs(900)).await;
        let mut owner = held.lock().unwrap_or_else(|poison| poison.into_inner());
        if owner.as_deref() == Some(&token) {
            *owner = None;
            accepting.store(!activity.is_paused(), Ordering::SeqCst);
        }
    });
    (200, json!({"success":true,"paused":true}))
}

fn runs_response(state: &AppState, paths: &StatePaths) -> RunsResponse {
    RunsResponse {
        success: true,
        runs: projected_run_records(paths, &state.instance_id, state.native_recovery_confirmed)
            .unwrap_or_default(),
    }
}

fn start_run_response(
    state: &AppState,
    request: RunRequest,
    owned: Option<&OwnedContext>,
) -> (u16, RunRecord) {
    let _admission = state
        .update_admission
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    if !state.accepting_work.load(Ordering::SeqCst) {
        let record = new_run_record(&state.paths, request, "rejected");
        return (503, record);
    }

    let Some(owned) =
        owned.filter(|context| context.can_write && still_current(&state.paths, context))
    else {
        return (403, new_run_record(&state.paths, request, "rejected"));
    };
    let Some(activity) = state.ownership_activity.begin(|| {
        state.accepting_work.load(Ordering::SeqCst) && still_current(&state.paths, owned)
    }) else {
        return (503, new_run_record(&state.paths, request, "rejected"));
    };
    let mut record = new_run_record(&owned.data_paths, request, "queued");
    // Stamp before the first durable queued record, not after spawning.
    record.daemon_instance_id = Some(state.instance_id.clone());
    if write_run_record(&owned.data_paths, &record).is_err() {
        record.status = "failed".into();
        return (503, record);
    }
    record_owned_event(
        state,
        owned,
        "queue.started",
        json!({
            "id": record.id,
            "agentId": record.agent_id,
            "workspace": record.workspace
        }),
    );
    spawn_run_worker(
        state.paths.clone(),
        owned.clone(),
        record.clone(),
        state.device_id.clone(),
        state.config.telemetry_enabled(),
        activity,
        state.instance_id.clone(),
    );
    record.status = "running".to_string();
    (202, record)
}

fn run_logs_response(paths: &StatePaths, id: &str) -> (u16, LogResponse) {
    let id = if valid_record_id(id) {
        id
    } else {
        "invalid-record"
    };
    let log_path = paths.runs_dir.join(format!("{id}.log"));
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

fn server_logs_response(paths: &StatePaths) -> LogResponse {
    let content = fs::read_to_string(&paths.server_log).unwrap_or_default();
    LogResponse {
        success: true,
        path: paths.server_log.display().to_string(),
        content,
    }
}

fn telemetry_response(
    state: &AppState,
    event: TelemetryEvent,
    owned: &OwnedContext,
) -> LifecycleResponse {
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
        let _ = append_telemetry_event(&owned.data_paths, event);
    }
    LifecycleResponse {
        success: true,
        message: "telemetry queued".to_string(),
    }
}

fn begin_owned_activity(
    state: &AppState,
    expected: Option<&OwnedContext>,
) -> Option<(OwnedContext, OwnedActivity)> {
    let owned = match expected {
        Some(context) => context.clone(),
        None => read_active_context(&state.paths).ok().flatten()?,
    };
    let activity = state
        .ownership_activity
        .begin(|| still_current(&state.paths, &owned))?;
    Some((owned, activity))
}

async fn heartbeat_response(
    state: &AppState,
    expected: Option<&OwnedContext>,
) -> LifecycleResponse {
    let Some((owned, _activity)) = begin_owned_activity(state, expected) else {
        return LifecycleResponse {
            success: false,
            message: "No verified owner is ready.".into(),
        };
    };
    let metrics = metrics_for_context(state, &owned);
    record_owned_event(
        state,
        &owned,
        "daemon.heartbeat",
        json!({"queueDepth":metrics.queue_depth,"activeWork":metrics.active_runs}),
    );
    let ping = send_ping(state, &owned).await;
    if let Some(error) = ping.remote_error {
        append_server_log(
            &owned.data_paths,
            &format!("heartbeat remote ping failed: {error}"),
        );
    }
    LifecycleResponse {
        success: true,
        message: "heartbeat recorded".into(),
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

async fn sync_now_response(state: &AppState, expected: Option<&OwnedContext>) -> SyncSnapshot {
    let lease = begin_owned_activity(state, expected);
    let metrics = lease
        .as_ref()
        .map(|(owned, _)| metrics_for_context(state, owned))
        .unwrap_or_default();
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
        plan_state: "unknown".into(),
        run_count: metrics.run_count,
        remote_status: None,
        remote_error: None,
    };

    let ping = match lease.as_ref() {
        Some((owned, _)) => send_ping(state, owned).await,
        None => skipped_ping(state),
    };
    snapshot.remote_status = ping.remote_status;
    snapshot.remote_error = ping.remote_error;

    if let Some((owned, _activity)) = lease {
        let _ = write_json(&owned.data_paths.sync_json, &snapshot);
        record_owned_event(
            state,
            &owned,
            "api.sync",
            json!({
                "apiBaseUrl": snapshot.api_base_url,
                "queueDepth": snapshot.queue_depth,
                "activeWork": snapshot.active_work,
                "remoteStatus": snapshot.remote_status,
                "remoteError": snapshot.remote_error
            }),
        );
    }
    snapshot
}

async fn register_device_response(state: &AppState) -> crate::api::DeviceRegistrationSnapshot {
    let api = ApiClient::new(machine_api_config(state), state.device_id.clone());
    let snapshot = api.register_device().await;
    let _ = write_json(&state.paths.device_registration_json, &snapshot);
    record_daemon_event(
        state,
        "device.registered",
        json!({
            "remoteState": snapshot.remote_state,
            "remoteStatus": snapshot.remote_status,
            "remoteError": snapshot.remote_error,
            "apiBaseUrl": snapshot.api_base_url
        }),
    );
    snapshot
}

async fn feature_flags_response(state: &AppState) -> crate::api::FeatureFlagSnapshot {
    let api = ApiClient::new(machine_api_config(state), state.device_id.clone());
    let snapshot = api.fetch_feature_flags().await;
    let _ = write_json(&state.paths.feature_flags_json, &snapshot);
    record_daemon_event(
        state,
        "feature_flags.checked",
        json!({
            "remoteState": snapshot.remote_state,
            "remoteStatus": snapshot.remote_status,
            "remoteError": snapshot.remote_error,
            "flags": snapshot.flags.iter().map(|flag| flag.key.clone()).collect::<Vec<_>>()
        }),
    );
    snapshot
}

async fn telemetry_flush_response(
    state: &AppState,
    expected: Option<&OwnedContext>,
) -> TelemetryFlushSnapshot {
    let lease = begin_owned_activity(state, expected);
    let config = lease
        .as_ref()
        .and_then(|(owned, _)| owned_api_config(state, owned));
    if !state.config.telemetry_enabled() || config.is_none() {
        return TelemetryFlushSnapshot {
            success: false,
            flushed_at: now_string(),
            api_base_url: state.config.api_base_url.clone(),
            client_type: "squad".into(),
            surface: "squad-daemon".into(),
            version: VERSION.into(),
            device_id: state.device_id.clone(),
            events_sent: 0,
            remote_state: crate::api::RemoteState::Disabled,
            remote_status: None,
            remote_error: None,
        };
    }
    let (owned, _activity) = lease.expect("verified config requires owner");
    let events = read_telemetry_events(&owned.data_paths, 250);
    let api = ApiClient::new(
        config.expect("verified owner config"),
        state.device_id.clone(),
    );

    let snapshot = api.send_telemetry_batch(&events).await;
    let _ = write_json(&owned.data_paths.telemetry_flush_json, &snapshot);
    snapshot
}

fn skipped_ping(state: &AppState) -> crate::api::PingSnapshot {
    crate::api::PingSnapshot {
        success: false,
        pinged_at: now_string(),
        api_base_url: state.config.api_base_url.clone(),
        client_type: "squad".into(),
        surface: "squad-daemon".into(),
        version: VERSION.into(),
        device_id: state.device_id.clone(),
        metrics: remote_metrics(DaemonMetrics::default()),
        plan_state: "unknown".into(),
        remote_state: crate::api::RemoteState::Disabled,
        remote_status: None,
        remote_error: None,
    }
}

async fn send_ping(state: &AppState, owned: &OwnedContext) -> crate::api::PingSnapshot {
    let Some(config) = owned_api_config(state, owned) else {
        return skipped_ping(state);
    };
    let metrics = metrics_for_context(state, owned);
    if !still_current(&state.paths, owned) {
        return skipped_ping(state);
    }
    let api = ApiClient::new(config, state.device_id.clone());
    let snapshot = api.send_ping(remote_metrics(metrics)).await;
    let _ = write_json(&owned.data_paths.ping_json, &snapshot);
    snapshot
}

// ---------------------------------------------------------------------------
// Bridge supervision (ADR-0123). `squad serve` spawned the Node bridge
// detached and nothing watched it afterwards: a crash left the desktop
// window pointing at a port nobody listened on. The daemon now probes the
// bridge with a deadline and brings it back, with a backoff so a bridge that
// cannot start does not spin, and never while a stop is in progress (the
// web-server record is gone by then) or while the daemon itself is draining.

/// Seconds between probes of `GET /api/runtime` (800 ms deadline each).
const BRIDGE_PROBE_INTERVAL: Duration = Duration::from_secs(5);
/// Consecutive failed probes before a bridge that is alive but silent is
/// restarted: a minute. Three probes (15 s) killed a bridge that was waiting
/// on macOS's Documents-folder privacy prompt before anyone could answer it,
/// every time, and each new process asked again (ADR-0123, second revision).
/// A gone process is still restarted at once.
pub(crate) const BRIDGE_PROBE_FAILURES_BEFORE_RESTART: u32 = 12;
const BRIDGE_RESTART_BACKOFF_BASE: Duration = Duration::from_secs(5);
const BRIDGE_RESTART_BACKOFF_CAP: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum BridgeAction {
    /// No bridge record: the person stopped it, or it was never started here.
    Skip,
    /// The bridge answered.
    Healthy,
    /// A probe failed but the process is alive; wait for the next probe.
    Wait,
    /// Start the bridge again, with the reason for the log.
    Restart(String),
}

/// Pure: what to do after one probe. `failures` counts the consecutive
/// failed probes before this one.
pub(crate) fn bridge_action(
    record_present: bool,
    accepting_work: bool,
    pid_alive: bool,
    probe_ok: bool,
    failures: u32,
) -> BridgeAction {
    if !record_present || !accepting_work {
        return BridgeAction::Skip;
    }
    if probe_ok {
        return BridgeAction::Healthy;
    }
    if !pid_alive {
        return BridgeAction::Restart("the bridge process is gone".to_string());
    }
    let failed = failures + 1;
    if failed >= BRIDGE_PROBE_FAILURES_BEFORE_RESTART {
        return BridgeAction::Restart(format!(
            "the bridge did not answer {failed} probes in a row ({}s each)",
            BRIDGE_PROBE_INTERVAL.as_secs()
        ));
    }
    BridgeAction::Wait
}

/// Pure: how long to wait after the n-th consecutive restart (0-based)
/// before probing again: 5 s, 10 s, 20 s, 40 s, then a minute.
pub(crate) fn bridge_restart_backoff(restarts_in_row: u32) -> Duration {
    let factor = 1u32 << restarts_in_row.min(4);
    (BRIDGE_RESTART_BACKOFF_BASE * factor).min(BRIDGE_RESTART_BACKOFF_CAP)
}

fn spawn_bridge_supervisor(state: Arc<AppState>) {
    tokio::spawn(async move {
        let mut failures: u32 = 0;
        let mut restarts_in_row: u32 = 0;
        loop {
            sleep(BRIDGE_PROBE_INTERVAL).await;
            let record = read_web_server_record(&state.paths).ok().flatten();
            let record = match record {
                Some(record) if record.host == state.config.host => record,
                _ => {
                    failures = 0;
                    restarts_in_row = 0;
                    continue;
                }
            };
            let host = record.host.clone();
            let port = record.port;
            let pid = record.pid;
            let probe = tokio::task::spawn_blocking(move || web_runtime_is_ready(&host, port))
                .await
                .unwrap_or(false);
            let alive = if probe {
                true
            } else {
                tokio::task::spawn_blocking(move || process_is_running(pid))
                    .await
                    .unwrap_or(false)
            };
            match bridge_action(
                true,
                state.accepting_work.load(Ordering::SeqCst),
                alive,
                probe,
                failures,
            ) {
                BridgeAction::Skip => {
                    failures = 0;
                }
                BridgeAction::Healthy => {
                    if restarts_in_row > 0 {
                        append_server_log(&state.paths, "web server is answering again");
                    }
                    failures = 0;
                    restarts_in_row = 0;
                }
                BridgeAction::Wait => {
                    failures += 1;
                    append_server_log(
                        &state.paths,
                        &format!(
                            "web server did not answer probe {failures} of {BRIDGE_PROBE_FAILURES_BEFORE_RESTART} (pid {pid} alive)"
                        ),
                    );
                }
                BridgeAction::Restart(reason) => {
                    failures = 0;
                    append_server_log(
                        &state.paths,
                        &format!("web server restart: {reason}; restarting pid {pid}"),
                    );
                    let paths = state.paths.clone();
                    let config = state.config.clone();
                    let server_path = record.server_path.clone();
                    let dev = record.dev;
                    let admission = state.update_admission.clone();
                    let accepting = state.accepting_work.clone();
                    let activity = state.ownership_activity.clone();
                    let result = tokio::task::spawn_blocking(move || {
                        let _admission = admission
                            .lock()
                            .unwrap_or_else(|poison| poison.into_inner());
                        if !accepting.load(Ordering::SeqCst) || activity.is_paused() {
                            return Ok(());
                        }
                        if process_is_running(pid) {
                            terminate_process(pid);
                        }
                        spawn_web_server(&paths, &config, Path::new(&server_path), dev, port)
                    })
                    .await
                    .unwrap_or_else(|error| Err(anyhow!("restart task failed: {error}")));
                    match result {
                        Ok(()) => {
                            let count = state.web_restarts.fetch_add(1, Ordering::SeqCst) + 1;
                            let new_pid = read_web_server_record(&state.paths)
                                .ok()
                                .flatten()
                                .map(|record| record.pid)
                                .unwrap_or(0);
                            append_server_log(
                                &state.paths,
                                &format!("web server restarted as pid {new_pid} (restart {count} this daemon run)"),
                            );
                            record_daemon_event(
                                &state,
                                "daemon.web_server_restarted",
                                json!({ "reason": reason, "previousPid": pid, "pid": new_pid, "restarts": count }),
                            );
                        }
                        Err(error) => {
                            append_server_log(
                                &state.paths,
                                &format!("web server restart failed: {error:#}"),
                            );
                        }
                    }
                    let backoff = bridge_restart_backoff(restarts_in_row);
                    restarts_in_row = restarts_in_row.saturating_add(1);
                    sleep(backoff).await;
                }
            }
        }
    });
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

    let sync = sync_now_response(state, None).await;
    if let Some(error) = sync.remote_error {
        append_server_log(&state.paths, &format!("ping failed: {error}"));
    }

    if automatic_update_checks_enabled(&state.paths.root) {
        let updates = check_updates_response(state).await;
        if let Some(error) = updates.error {
            append_server_log(&state.paths, &format!("version check failed: {error}"));
        }
    }

    let flush = telemetry_flush_response(state, None).await;
    if let Some(error) = flush.remote_error {
        append_server_log(&state.paths, &format!("telemetry flush failed: {error}"));
    }
}

// Match the bridge's System switch. Explicit /updates/check remains ungated.
fn automatic_update_checks_enabled(root: &Path) -> bool {
    fs::read_to_string(root.join("settings.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|value| {
            value
                .get("autoCheckUpdates")
                .and_then(serde_json::Value::as_bool)
        })
        .unwrap_or(true)
}

async fn check_updates_response(state: &AppState) -> UpdateSnapshot {
    let checked_at = now_string();
    let result = match crate::squad_api::discover_release(&state.config.update_channel).await {
        Ok(discovered) => {
            let release = discovered.release;
            let installer = crate::install::select_desktop_installer(&release.manifest);
            UpdateSnapshot {
                success: true,
                checked_at,
                channel: state.config.update_channel.clone(),
                client_type: "squad".to_string(),
                surface: "squad-daemon".to_string(),
                device_id: state.device_id.clone(),
                current_version: VERSION.to_string(),
                update_available: crate::install::compare_versions(&release.version, VERSION)
                    == std::cmp::Ordering::Greater,
                latest_allowed_version: Some(release.version),
                manifest_url: discovered.manifest_url,
                error: None,
                source: discovered.source,
                release_url: Some(release.release_url),
                download_url: installer.as_ref().map(|artifact| artifact.url.clone()),
                download_name: installer
                    .as_ref()
                    .and_then(|artifact| artifact.binary_name.clone()),
                download_sha256: installer.as_ref().map(|artifact| artifact.sha256.clone()),
                notes: Some(release.notes),
            }
        }
        Err(error) => {
            let failure = error.downcast_ref::<crate::squad_api::DiscoveryError>();
            UpdateSnapshot {
                success: false,
                checked_at,
                channel: state.config.update_channel.clone(),
                client_type: "squad".to_string(),
                surface: "squad-daemon".to_string(),
                device_id: state.device_id.clone(),
                current_version: VERSION.to_string(),
                latest_allowed_version: None,
                update_available: false,
                manifest_url: failure
                    .map(|failure| failure.manifest_url.clone())
                    .unwrap_or_default(),
                error: Some(error.to_string()),
                source: failure
                    .map(|failure| failure.source.clone())
                    .unwrap_or_else(|| "squad-api".into()),
                release_url: None,
                download_url: None,
                download_name: None,
                download_sha256: None,
                notes: None,
            }
        }
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
            "source": result.source,
            "error": result.error
        }),
    );
    result
}

fn restart_response(state: &AppState) -> (u16, LifecycleResponse) {
    {
        let mut owner = state
            .update_admission
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        *owner = None;
        state.ownership_activity.stop();
        state.accepting_work.store(false, Ordering::SeqCst);
    }
    record_daemon_event(
        state,
        "daemon.restart_requested",
        json!({ "activeRuns": state.ownership_activity.active() }),
    );
    if let Ok(Some(mut record)) = read_daemon_record(&state.paths) {
        record.accepting_work = false;
        record.drain_requested_at = Some(now_string());
        let _ = write_daemon_record(&state.paths, &record);
    }

    let shutdown_tx = state.shutdown_tx.clone();
    let activity = state.ownership_activity.clone();
    tokio::spawn(async move {
        loop {
            if activity.active() == 0 {
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
    {
        let mut owner = state
            .update_admission
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        *owner = None;
        state.ownership_activity.stop();
        state.accepting_work.store(false, Ordering::SeqCst);
    }
    record_daemon_event(
        state,
        "daemon.stop_requested",
        json!({ "activeRuns": state.ownership_activity.active() }),
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
async fn channels_sync_response(
    state: &AppState,
    input: ChannelsState,
    owned: &OwnedContext,
) -> (u16, ChannelsState) {
    // The Node channels store owns canonical CAS/merging. Writing its JSON from
    // another process can overwrite a newer roster or conversation snapshot.
    let result = async {
        let record = read_web_server_record(&state.paths)?
            .ok_or_else(|| anyhow!("Squad bridge is unavailable"))?;
        let origin = reqwest::Url::parse(&record.url)?;
        if origin.scheme() != "http"
            || !matches!(origin.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
            || !origin.username().is_empty()
            || origin.password().is_some()
        {
            bail!("invalid local bridge origin");
        }
        if !still_current(&state.paths, owned) || !owned.can_write {
            bail!("Squad context changed");
        }
        let response = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()?
            .put(origin.join("/api/channels/sync")?)
            .header("x-squad-context", &owned.generation)
            .json(&input)
            .send()
            .await?;
        let status = response.status().as_u16();
        if !still_current(&state.paths, owned) {
            bail!("Squad context changed");
        }
        Ok::<u16, anyhow::Error>(status)
    }
    .await;
    (result.unwrap_or(503), input)
}

#[cfg(test)]
fn status_payload(state: &AppState) -> StatusResponse {
    let owned = read_active_context(&state.paths).ok().flatten();
    let response = status_payload_for_context(state, owned.as_ref());
    if owned
        .as_ref()
        .is_some_and(|context| !still_current(&state.paths, context))
    {
        return status_payload_for_context(state, None);
    }
    response
}

fn status_payload_for_context(state: &AppState, owned: Option<&OwnedContext>) -> StatusResponse {
    let daemon = read_daemon_record(&state.paths).ok().flatten();
    let metrics = owned
        .map(|context| metrics_for_context(state, context))
        .unwrap_or_default();
    let channels_state = owned
        .and_then(|context| read_channels_state(&context.data_paths).ok().flatten())
        .unwrap_or_default();
    StatusResponse {
        success: true,
        ownership: owned.map(|context| StatusOwnership {
            generation: context.generation.clone(),
            owner_key: context.owner_key.clone(),
            dataset_id: context.dataset_id.clone(),
        }),
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
            email: owned.and_then(|context| {
                (!context.actor.email.is_empty()).then(|| context.actor.email.clone())
            }),
            plan_state: "unknown".to_string(),
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
        last_ping_at: owned
            .and_then(|context| read_timestamp_field(&context.data_paths.ping_json, "pingedAt")),
        last_feature_flag_check_at: read_timestamp_field(
            &state.paths.feature_flags_json,
            "checkedAt",
        ),
        last_telemetry_flush_at: owned.and_then(|context| {
            read_timestamp_field(&context.data_paths.telemetry_flush_json, "flushedAt")
        }),
        last_sync_at: owned
            .and_then(|context| read_timestamp_field(&context.data_paths.sync_json, "syncedAt")),
        last_update_check_at: read_timestamp_field(&state.paths.update_json, "checkedAt"),
        web_server_restarts: state.web_restarts.load(Ordering::SeqCst),
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

#[derive(Default)]
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

fn metrics_for_context(state: &AppState, context: &OwnedContext) -> DaemonMetrics {
    let mut metrics = metrics_for_paths(
        &context.data_paths,
        &state.instance_id,
        state.native_recovery_confirmed,
    );
    if !context.can_write {
        metrics.queue_depth = 0;
        metrics.queued_jobs = 0;
        metrics.scheduled_jobs = 0;
        metrics.active_runs = 0;
        metrics.running_sessions = 0;
        metrics.active_trigger_work = 0;
        metrics.working_agents = 0;
        metrics.online_members = 0;
        metrics.jobs.clear();
        metrics.automations.clear();
        for member in &mut metrics.members {
            member.working = false;
            member.status = "offline".to_string();
            member.queued_jobs = 0;
            member.scheduled_jobs = 0;
        }
    }
    metrics
}
fn metrics_for_paths(paths: &StatePaths, instance: &str, recovered: bool) -> DaemonMetrics {
    let queue = read_queue_items(paths).unwrap_or_default();
    let runs = projected_run_records(paths, instance, recovered).unwrap_or_default();
    let live_status = read_fresh_live_status_snapshot(paths);
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

fn record_owned_event(
    state: &AppState,
    owned: &OwnedContext,
    event: &str,
    metadata: serde_json::Value,
) {
    if state.config.telemetry_enabled() {
        let _ = append_telemetry_event(
            &owned.data_paths,
            daemon_event(event, &state.device_id, Some(metadata)),
        );
    }
}

fn machine_api_config(state: &AppState) -> SquadConfig {
    let mut config = state.config.clone();
    config.api_auth_token = None;
    config.company_secret = None;
    config.account_email = None;
    config.plan_state = "unknown".into();
    config
}
fn owned_api_config(state: &AppState, owned: &OwnedContext) -> Option<SquadConfig> {
    use sha2::{Digest, Sha256};
    if !still_current(&state.paths, owned) {
        return None;
    }
    let token = crate::config::read_autohand_user_auth().token?;
    let fingerprint: String = Sha256::digest(token.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    if fingerprint != owned.credential_fingerprint || !still_current(&state.paths, owned) {
        return None;
    }
    let destination = reqwest::Url::parse(&state.config.api_base_url).ok()?;
    if destination.origin().ascii_serialization() != owned.owner.issuer
        || !destination.username().is_empty()
        || destination.password().is_some()
    {
        return None;
    }
    let mut config = machine_api_config(state);
    config.api_auth_token = Some(token);
    config.account_email = Some(owned.actor.email.clone());
    Some(config)
}

fn record_daemon_event(state: &AppState, event: &str, metadata: serde_json::Value) {
    if state.config.telemetry_enabled() {
        let _ = append_telemetry_event(
            &state.paths,
            daemon_event(event, &state.device_id, Some(metadata)),
        );
    }
}

fn active_run_count(state: &AppState, paths: &StatePaths) -> usize {
    projected_run_records(paths, &state.instance_id, state.native_recovery_confirmed)
        .map(|runs| runs.iter().filter(|run| run_is_active(run)).count())
        .unwrap_or(0)
}

fn run_is_active(run: &RunRecord) -> bool {
    run.status == "queued" || run.status == "running"
}

pub fn read_queue_items(paths: &StatePaths) -> Result<Vec<QueueItem>> {
    if !paths.queue_dir.exists() {
        return Ok(Vec::new());
    }
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

pub fn default_harness_id() -> String {
    "autohand".to_string()
}

pub fn normalize_harness_id(value: Option<&str>) -> String {
    match value.map(|item| item.trim().to_ascii_lowercase()) {
        Some(id) if id == "codex" => "codex".to_string(),
        Some(id) if id == "claude" || id == "claude-code" => "claude".to_string(),
        _ => default_harness_id(),
    }
}

fn harness_executable(harness: &str) -> String {
    let env_name = match harness {
        "codex" => "AUTOHAND_SQUAD_CODEX_BIN",
        "claude" => "AUTOHAND_SQUAD_CLAUDE_BIN",
        _ => "AUTOHAND_SQUAD_AUTOHAND_BIN",
    };
    std::env::var(env_name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            match harness {
                "codex" => "codex",
                "claude" => "claude",
                _ => "autohand",
            }
            .to_string()
        })
}

/// Build the non-interactive command for a queued run under the selected
/// harness. Every harness receives the prompt as one argument (never through
/// a shell) and the workspace as its working root.
pub fn harness_command(
    harness: &str,
    prompt: &str,
    workspace: Option<&str>,
    extra_args: Option<&[String]>,
) -> Vec<String> {
    let executable = harness_executable(harness);
    let mut command = match harness {
        "codex" => {
            let mut command = vec![
                executable,
                "exec".to_string(),
                "--json".to_string(),
                "--skip-git-repo-check".to_string(),
                "--color".to_string(),
                "never".to_string(),
            ];
            if let Some(workspace) = workspace {
                command.push("-C".to_string());
                command.push(workspace.to_string());
            }
            command
        }
        "claude" => {
            let mut command = vec![
                executable,
                "-p".to_string(),
                "--output-format".to_string(),
                "json".to_string(),
                "--verbose".to_string(),
            ];
            if let Some(workspace) = workspace {
                command.push("--add-dir".to_string());
                command.push(workspace.to_string());
            }
            command
        }
        _ => {
            let mut command = vec![executable, "--prompt".to_string(), prompt.to_string()];
            if let Some(workspace) = workspace {
                command.push("--path".to_string());
                command.push(workspace.to_string());
            }
            command
        }
    };
    if let Some(extra_args) = extra_args {
        command.extend(extra_args.iter().cloned());
    }
    if harness == "codex" || harness == "claude" {
        // Prompt goes last so vendor flags parse before the free-form text.
        command.push(prompt.to_string());
    }
    command
}

fn new_run_record(paths: &StatePaths, request: RunRequest, status: &str) -> RunRecord {
    let id = next_id();
    let harness = normalize_harness_id(request.harness.as_deref());
    let command = harness_command(
        &harness,
        &request.prompt,
        request.workspace.as_deref(),
        request.extra_args.as_deref(),
    );
    RunRecord {
        id: id.clone(),
        status: status.to_string(),
        prompt: request.prompt,
        workspace: request.workspace,
        agent_id: request.agent_id,
        harness,
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
        daemon_instance_id: None,
        recovery_status: None,
    }
}

fn next_id() -> String {
    let sequence = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    let timestamp = now_string().replace(':', "-");
    format!("{timestamp}-{sequence}")
}

struct RunConfigGuard(PathBuf);
impl Drop for RunConfigGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[cfg(unix)]
struct RunProcessGroup {
    pid: u32,
    gate: Arc<OwnershipActivity>,
    verified: bool,
    intent: crate::native_work_intents::NativeWorkIntent,
}
#[cfg(unix)]
impl Drop for RunProcessGroup {
    fn drop(&mut self) {
        if self.verified {
            return;
        }
        unsafe {
            libc::kill(-(self.pid as i32), libc::SIGKILL);
        }
        if !self.verified {
            self.gate.uncertain_cleanup();
        }
    }
}

#[cfg(unix)]
async fn finish_process_group(group: &mut RunProcessGroup) -> Result<()> {
    unsafe {
        libc::kill(-(group.pid as i32), libc::SIGKILL);
    }
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let exists = unsafe { libc::kill(-(group.pid as i32), 0) };
        if exists == -1 && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH) {
            group.intent.clear()?;
            group.verified = true;
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            bail!("Could not confirm the native process group exited");
        }
        sleep(Duration::from_millis(20)).await;
    }
}

fn spawn_run_worker(
    service_paths: StatePaths,
    owned: OwnedContext,
    mut record: RunRecord,
    device_id: String,
    telemetry_enabled: bool,
    activity: OwnedActivity,
    instance_id: String,
) {
    tokio::spawn(async move {
        let _activity = activity;
        let gate = _activity.gate();
        let paths = owned.data_paths.clone();
        if gate.is_paused() || !owned.can_write || !still_current(&service_paths, &owned) {
            record.status = "interrupted".into();
            record.completed_at = Some(now_string());
            let _ = write_run_record(&paths, &record);
            return;
        }
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
        let result = async {
            #[cfg(not(any(unix,windows)))] bail!("Native process-tree supervision is unavailable on this platform.");
            if !still_current(&service_paths, &owned) { bail!("The Squad context changed before execution."); }
            let config_dir = owned.app_root.join("native-runs").join(&record.id);
            fs::create_dir_all(&config_dir)?;
            let runtime_config = config_dir.join("config.json");
            let _config_guard = RunConfigGuard(runtime_config.clone());
            if record.harness == "autohand" {
                use sha2::{Digest, Sha256};
                let auth = crate::config::read_autohand_user_auth();
                let token = auth.token.as_deref().unwrap_or("");
                let fingerprint: String = Sha256::digest(token.as_bytes()).iter().map(|byte| format!("{byte:02x}")).collect();
                if fingerprint != owned.credential_fingerprint || !still_current(&service_paths, &owned) { bail!("The sign-in credential changed before execution."); }
                use std::io::Write;
                let mut options = fs::OpenOptions::new(); options.write(true).create_new(true);
                #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600).custom_flags(libc::O_NOFOLLOW); }
                let mut file = options.open(&runtime_config)?;
                file.write_all(serde_json::to_string(&json!({"provider":"autohandai","auth":{"token":token,"user":{"email":owned.actor.email}},"telemetry":{"enabled":false}}))?.as_bytes())?;
            }
            let mut options = fs::OpenOptions::new(); options.write(true).create_new(true);
            #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600).custom_flags(libc::O_NOFOLLOW); }
            let log = options.open(&log_path)?;
            let mut intent = crate::native_work_intents::NativeWorkIntent::create(&service_paths, &record.id, &instance_id, gate.clone())?;
            #[cfg(windows)] let mut windows_job=crate::owned_windows::JobWatchdog::start(&crate::cli::locate_daemon_binary(&service_paths)?,intent.job_name(),&intent.receipt_path()).await?;
            #[cfg(unix)]
            let mut command = Command::new("/bin/sh");
            #[cfg(unix)]
            command.args(["-c", "IFS= read -r squad_start || exit 125; [ \"$squad_start\" = start ] || exit 125; exec \"$@\"", "squad-run"]);
            #[cfg(windows)]
            let mut command = {let mut command=Command::new(crate::cli::locate_daemon_binary(&service_paths)?);command.arg("--ownership-launch");command};
            command.args(&record.command);
            #[cfg(windows)] command.env("AUTOHAND_SQUAD_WIN_JOB_PIPE",crate::owned_windows::job_pipe(intent.job_name())?);
            command.env("PATH", crate::cli::gui_path_env()).stdin(std::process::Stdio::piped());
            command.env_remove("AUTOHAND_SQUAD_NATIVE_GRANT_TOKEN").env_remove("AUTOHAND_SQUAD_WORKER_TOKEN").env_remove("AUTOHAND_SQUAD_WORKER_CONTEXT");
            command.stdout(std::process::Stdio::from(log.try_clone()?)).stderr(std::process::Stdio::from(log));
            command.kill_on_drop(true);
            #[cfg(unix)] command.process_group(0);
            if record.harness == "autohand" { command.env("AUTOHAND_USER_CONFIG_PATH", &runtime_config); }
            if let Some(workspace) = &record.workspace {
                let candidate = PathBuf::from(workspace).canonicalize()?;
                let service_root = service_paths.root.canonicalize()?;
                if candidate.starts_with(&service_root) && !candidate.starts_with(owned.workspace_root.canonicalize()?) { bail!("Private Squad account data is not a work folder."); }
                command.current_dir(candidate);
            }
            if !still_current(&service_paths, &owned) { bail!("The Squad context changed before execution."); }
            let mut child = command.spawn()?;
            let pid = child.id();
            #[cfg(windows)] {
                windows_job.attached(pid.context("Native launch identity is unavailable")?).await?;
                intent.spawned(pid)?;
            }
            #[cfg(unix)] let mut group_guard = pid.map(|pid| RunProcessGroup {pid, gate:gate.clone(), verified:false, intent});
            #[cfg(unix)] if let Some(group) = group_guard.as_mut() { group.intent.spawned(pid)?; }
            if let Some(mut input) = child.stdin.take() { input.write_all(b"start\n").await?; }
            let kill_group = |signal: i32| {
                #[cfg(unix)] if let Some(pid) = pid { unsafe { libc::kill(-(pid as i32), signal); } }
                #[cfg(not(unix))] { let _ = (signal, pid); }
            };
            let mut ticker = tokio::time::interval(Duration::from_millis(250));
            let (status, interrupted) = loop {
                tokio::select! {
                    status = child.wait() => break (status?, false),
                    _ = ticker.tick() => {
                        let oversized = fs::metadata(&log_path).is_ok_and(|metadata| metadata.len() > 32 * 1024 * 1024);
                        if gate.is_paused() || !still_current(&service_paths, &owned) || oversized {
                            #[cfg(unix)] kill_group(libc::SIGTERM);
                            #[cfg(not(unix))] { let _ = child.start_kill(); }
                            let status = match tokio::time::timeout(Duration::from_millis(2500), child.wait()).await {
                                Ok(status) => status?,
                                Err(_) => { #[cfg(unix)] kill_group(libc::SIGKILL); let _ = child.start_kill(); child.wait().await? }
                            };
                            break (status, true);
                        }
                    }
                }
            };
            #[cfg(unix)] if let Some(group) = group_guard.as_mut() { finish_process_group(group).await?; }
            #[cfg(windows)] {
                let result=windows_job.terminate().await;
                if result.is_err() {gate.uncertain_cleanup();}
                result?;intent.clear()?;
            }
            if record.harness == "autohand" { let _ = fs::remove_file(runtime_config); }
            Ok::<_, anyhow::Error>((status.code(), if interrupted || !still_current(&service_paths, &owned) { "interrupted" } else if status.success() { "completed" } else { "failed" }))
        }.await;
        match result {
            Ok((code, status)) => {
                record.exit_code = code;
                record.status = status.into();
            }
            Err(error) => {
                let _ = tokio::fs::write(&log_path, error.to_string()).await;
                record.status = if still_current(&service_paths, &owned) {
                    "failed"
                } else {
                    "interrupted"
                }
                .into();
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
    if !paths.runs_dir.exists() {
        return Ok(Vec::new());
    }
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

fn project_run_record(mut record: RunRecord, instance: &str, recovered: bool) -> RunRecord {
    record.recovery_status = None;
    if !run_is_active(&record) || record.daemon_instance_id.as_deref() == Some(instance) {
        return record;
    }
    if record.daemon_instance_id.is_some() && recovered {
        record.status = "interrupted".into();
        record.recovery_status = Some("previous-daemon".into());
    } else {
        record.status = "unknown".into();
        record.recovery_status = Some(
            if record.daemon_instance_id.is_some() {
                "process-cleanup-unconfirmed"
            } else {
                "legacy-execution-unverified"
            }
            .into(),
        );
    }
    record
}

fn projected_run_records(
    paths: &StatePaths,
    instance: &str,
    recovered: bool,
) -> Result<Vec<RunRecord>> {
    Ok(read_run_records(paths)?
        .into_iter()
        .map(|record| project_run_record(record, instance, recovered))
        .collect())
}

fn valid_record_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && id.as_bytes()[0].is_ascii_alphanumeric()
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
}

fn read_run_record(paths: &StatePaths, id: &str) -> Result<Option<RunRecord>> {
    if !valid_record_id(id) {
        return Ok(None);
    }
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
    // The same message as an OpenTelemetry log record (logs/daemon.otlp.jsonl),
    // classified by content so collectors can alert on ERROR without grep.
    let lower = message.to_ascii_lowercase();
    let severity = if lower.contains("failed") || lower.contains("error") {
        crate::otel::Severity::Error
    } else {
        crate::otel::Severity::Info
    };
    let run_id = message
        .strip_prefix("run ")
        .and_then(|rest| rest.split_whitespace().next())
        .map(|id| serde_json::Value::String(id.to_string()))
        .unwrap_or(serde_json::Value::Null);
    crate::otel::daemon_log(paths, severity, message, &[("autohand.run.id", run_id)]);
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
    #[cfg(any(unix, windows))]
    #[tokio::test]
    async fn owned_native_run_stops_its_group_after_context_loss() {
        use super::*;
        struct RestoreAuth(&'static str, Option<std::ffi::OsString>);
        impl Drop for RestoreAuth {
            fn drop(&mut self) {
                match &self.1 {
                    Some(value) => std::env::set_var(self.0, value),
                    None => std::env::remove_var(self.0),
                }
            }
        }
        #[cfg(windows)]
        let _helper = {
            let key = "AUTOHAND_SQUAD_DAEMON";
            let guard = RestoreAuth(key, std::env::var_os(key));
            let executable = std::env::current_exe().unwrap();
            let helper = executable
                .parent()
                .unwrap()
                .parent()
                .unwrap()
                .join("autohand-squad-daemon.exe");
            assert!(
                helper.is_file(),
                "Build the real daemon helper before Windows runtime tests"
            );
            std::env::set_var(key, helper);
            guard
        };
        let mut fixture = crate::ownership::tests::Fixture::new();
        let config = fixture.service.root.join("fixture-auth.json");
        fs::write(&config, r#"{"auth":{"token":"fixture-only-token"}}"#).unwrap();
        let _restore = RestoreAuth(
            "AUTOHAND_USER_CONFIG_PATH",
            std::env::var_os("AUTOHAND_USER_CONFIG_PATH"),
        );
        std::env::set_var("AUTOHAND_USER_CONFIG_PATH", config);
        let owned = read_active_context(&fixture.service).unwrap().unwrap();
        let gate = Arc::new(OwnershipActivity::default());
        let native_record = DaemonRecord {
            pid: std::process::id(),
            host: "127.0.0.1".into(),
            port: 0,
            url: "fixture".into(),
            accepting_work: true,
            started_at: now_string(),
            drain_requested_at: None,
        };
        write_daemon_record(&fixture.service, &native_record).unwrap();
        let instance = format!("{}:{}", native_record.pid, native_record.started_at);
        let token = "a".repeat(64);
        fs::write(
            fixture.service.root.join("ownership-control.json"),
            serde_json::to_vec(&json!({"brokerId":"fixture-broker", "token":token})).unwrap(),
        )
        .unwrap();
        let state = Arc::new(AppState {
            paths: fixture.service.clone(),
            config: SquadConfig::defaults(),
            account_email: Arc::new(StdMutex::new(None)),
            accepting_work: Arc::new(AtomicBool::new(true)),
            update_admission: Arc::new(StdMutex::new(None)),
            ownership_activity: gate.clone(),
            instance_id: instance.clone(),
            native_recovery_confirmed: true,
            shutdown_tx: Arc::new(Mutex::new(None)),
            device_id: "fixture".into(),
            web_restarts: Arc::new(AtomicU64::new(0)),
        });
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let listener_task = tokio::spawn(async move {
            loop {
                let (stream, _) = listener.accept().await.unwrap();
                let state = state.clone();
                tokio::spawn(async move {
                    handle_connection(stream, state).await.unwrap();
                });
            }
        });
        let sentinel = owned.workspace_root.join("native-worker-writes");
        let mut record = new_run_record(
            &owned.data_paths,
            RunRequest {
                prompt: "fixture".into(),
                workspace: Some(owned.workspace_root.display().to_string()),
                agent_id: Some("eva".into()),
                extra_args: None,
                harness: Some("codex".into()),
                channel_id: None,
                thread_id: None,
            },
            "queued",
        );
        #[cfg(unix)]
        {
            record.command = vec![
                "/bin/sh".into(),
                "-c".into(),
                "trap '' TERM; while :; do printf x >> \"$1\"; sleep 0.05; done".into(),
                "native-fixture".into(),
                sentinel.display().to_string(),
            ];
        }
        #[cfg(windows)]
        {
            record.command=vec!["powershell.exe".into(),"-NoProfile".into(),"-NonInteractive".into(),"-Command".into(),format!("while ($true) {{ Add-Content -LiteralPath '{}' -Value x; Start-Sleep -Milliseconds 50 }}",sentinel.display().to_string().replace('\'',"''"))];
        }
        write_run_record(&owned.data_paths, &record).unwrap();
        spawn_run_worker(
            fixture.service.clone(),
            owned.clone(),
            record.clone(),
            "fixture-device".into(),
            false,
            gate.begin(|| true).unwrap(),
            instance.clone(),
        );
        let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
        while !fs::metadata(&sentinel).is_ok_and(|info| info.len() > 0) {
            assert!(
                tokio::time::Instant::now() < deadline,
                "native child did not start"
            );
            sleep(Duration::from_millis(20)).await;
        }
        let client = reqwest::Client::new();
        assert_eq!(
            client
                .get(format!("{origin}/runs"))
                .send()
                .await
                .unwrap()
                .status(),
            409
        );
        assert_eq!(
            client
                .get(format!("{origin}/runs"))
                .header("x-squad-context", &owned.generation)
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
        assert_eq!(
            client
                .get(format!("{origin}/ownership/status"))
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
        let operation = "12345678-1234-1234-1234-123456789012";
        let drain_client = client.clone();
        let drain_origin = origin.clone();
        let drain_token = token.clone();
        let drain_instance = instance.clone();
        let drain = tokio::spawn(async move {
            drain_client.post(format!("{drain_origin}/ownership/drain")).header("x-squad-ownership-control", drain_token).json(&json!({"brokerId":"fixture-broker","instanceId":drain_instance,"operationId":operation})).send().await.unwrap()
        });
        sleep(Duration::from_millis(100)).await;
        #[cfg(unix)]
        assert!(
            !drain.is_finished(),
            "a hidden worker is not a completed drain"
        );
        fixture.receipt["state"] = json!("blocked");
        fixture.save();
        loop {
            let saved = read_run_record(&owned.data_paths, &record.id)
                .unwrap()
                .unwrap();
            if saved.status == "interrupted" {
                break;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "native run outlived its context"
            );
            sleep(Duration::from_millis(30)).await;
        }
        let count = fs::metadata(&sentinel).unwrap().len();
        sleep(Duration::from_millis(250)).await;
        assert_eq!(
            fs::metadata(&sentinel).unwrap().len(),
            count,
            "no descendant keeps writing after completion"
        );
        assert!(
            !fixture
                .service
                .runs_dir
                .join(format!("{}.json", record.id))
                .exists(),
            "completion stays in the departing dataset"
        );
        let response = drain.await.unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(
            response.json::<serde_json::Value>().await.unwrap()["drained"],
            true
        );
        assert!(gate.drained(operation).unwrap());
        assert_eq!(
            fs::read_dir(fixture.service.root.join("native-work-intents"))
                .unwrap()
                .count(),
            0,
            "the durable process intent clears only after verified group exit"
        );
        let mut replacement = native_record;
        replacement.started_at = "replacement".into();
        write_daemon_record(&fixture.service, &replacement).unwrap();
        assert_eq!(
            client
                .get(format!("{origin}/ownership/status"))
                .header("x-squad-ownership-control", token)
                .send()
                .await
                .unwrap()
                .status(),
            409,
            "an old listener never claims a replacement incarnation"
        );
        listener_task.abort();
    }
    #[tokio::test]
    async fn observability_does_not_repeat_unsupported_remote_requests_or_errors() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let requests = Arc::new(AtomicU64::new(0));
        let observed = requests.clone();
        let server = tokio::spawn(async move {
            loop {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                loop {
                    let mut chunk = [0; 4096];
                    let count = stream.read(&mut chunk).await.unwrap();
                    if count == 0 {
                        break;
                    }
                    bytes.extend_from_slice(&chunk[..count]);
                    if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&bytes[..end]);
                        let length = headers
                            .lines()
                            .find_map(|line| {
                                let (key, value) = line.split_once(':')?;
                                key.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse::<usize>().unwrap())
                            })
                            .unwrap_or(0);
                        if bytes.len() >= end + 4 + length {
                            break;
                        }
                    }
                }
                observed.fetch_add(1, Ordering::SeqCst);
                stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}").await.unwrap();
            }
        });
        let mut fixture = crate::ownership::tests::Fixture::new();
        let issuer = format!("http://{address}");
        let old_key = fixture.receipt["scopeKey"].as_str().unwrap().to_string();
        use sha2::{Digest, Sha256};
        let key = Sha256::digest(serde_json::to_vec(&[issuer.as_str(), "user", "alice"]).unwrap())
            .iter().map(|byte| format!("{byte:02x}")).collect::<String>();
        let old_base = fixture.service.root.join("owners").join(&old_key);
        let base = fixture.service.root.join("owners").join(&key);
        fs::rename(old_base, &base).unwrap();
        let dataset = fixture.receipt["datasetId"].as_str().unwrap().to_string();
        let root = base.join("datasets").join(&dataset);
        fixture.receipt["scopeKey"] = json!(key);
        fixture.receipt["owner"]["issuer"] = json!(issuer);
        fixture.receipt["actor"]["issuer"] = json!(issuer);
        fixture.receipt["dataRoot"] = json!(root.join("state"));
        fixture.receipt["appRoot"] = json!(root.join("app"));
        fixture.receipt["workspaceRoot"] = json!(root.join("member-homes"));
        fs::write(
            base.join("current.json"),
            json!({"version":1,"ownerKey":key,"datasetId":dataset}).to_string(),
        )
        .unwrap();
        fixture.save();
        let _auth = fixture.authenticate();
        let paths = fixture.service.clone();
        let owned = read_active_context(&paths).unwrap().unwrap();
        append_telemetry_event(
            &owned.data_paths,
            TelemetryEvent::new("fixture-owned-event"),
        )
        .unwrap();
        paths.ensure().unwrap();
        fs::write(
            paths.root.join("settings.json"),
            r#"{"autoCheckUpdates":false}"#,
        )
        .unwrap();
        let mut config = SquadConfig::defaults();
        config.api_base_url = format!("http://{address}");
        let state = AppState {
            paths: paths.clone(),
            config,
            account_email: Arc::new(StdMutex::new(None)),
            accepting_work: Arc::new(AtomicBool::new(true)),
            update_admission: Arc::new(StdMutex::new(None)),
            ownership_activity: Arc::new(OwnershipActivity::default()),
            instance_id: "fixture-instance".into(),
            native_recovery_confirmed: true,
            shutdown_tx: Arc::new(Mutex::new(None)),
            device_id: "optional-api-fixture".into(),
            web_restarts: Arc::new(AtomicU64::new(0)),
        };
        for _ in 0..3 {
            run_observability_cycle(&state).await;
        }

        assert_eq!(
            requests.load(Ordering::SeqCst),
            4,
            "missing optional endpoints must be probed once, not every observability cycle"
        );
        let log = fs::read_to_string(paths.root.join("logs/daemon.otlp.jsonl")).unwrap_or_default();
        assert!(
            !log.contains("failed with HTTP 404"),
            "unsupported optional endpoints must not be logged as recurring errors: {log}"
        );
        for path in [
            &paths.device_registration_json,
            &paths.feature_flags_json,
            &owned.data_paths.ping_json,
            &owned.data_paths.telemetry_flush_json,
        ] {
            let snapshot: serde_json::Value =
                serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
            assert_eq!(snapshot["success"], false);
            assert_eq!(snapshot["remoteState"], "unsupported");
            assert_eq!(snapshot["remoteStatus"], 404);
            assert!(snapshot["remoteError"].is_null());
        }
        let telemetry: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(&owned.data_paths.telemetry_flush_json).unwrap(),
        )
        .unwrap();
        assert_eq!(telemetry["eventsSent"], 0);
        fixture.receipt["state"] = json!("locked");
        fixture.save();
        for _ in 0..3 {
            run_observability_cycle(&state).await;
        }
        assert_eq!(
            requests.load(Ordering::SeqCst),
            4,
            "locked contexts must never send private metrics or telemetry"
        );
        let skipped = telemetry_flush_response(&state, None).await;
        assert_eq!(skipped.remote_state, crate::api::RemoteState::Disabled);
        assert!(skipped.remote_error.is_none());
        assert!(skipped_ping(&state).remote_error.is_none());
        server.abort();
    }

    #[tokio::test]
    async fn update_admission_refuses_new_work_and_preserves_queued_work() {
        let fixture = crate::ownership::tests::Fixture::new();
        let _auth = fixture.authenticate();
        let paths = fixture.service.clone();
        let owned = read_active_context(&paths).unwrap().unwrap();
        paths.ensure().unwrap();
        let state = AppState {
            paths: paths.clone(),
            config: SquadConfig::defaults(),
            account_email: Arc::new(StdMutex::new(None)),
            accepting_work: Arc::new(AtomicBool::new(true)),
            update_admission: Arc::new(StdMutex::new(None)),
            ownership_activity: Arc::new(OwnershipActivity::default()),
            instance_id: "fixture-instance".into(),
            native_recovery_confirmed: true,
            shutdown_tx: Arc::new(Mutex::new(None)),
            device_id: "fixture".into(),
            web_restarts: Arc::new(AtomicU64::new(0)),
        };
        let token = "01234567-0123-0123-0123-012345678901";
        assert_eq!(update_admission_response(&state, token, true).0, 200);
        assert!(!state.accepting_work.load(Ordering::SeqCst));
        let request = RunRequest {
            prompt: "must not run".into(),
            workspace: None,
            agent_id: None,
            extra_args: None,
            harness: None,
            channel_id: None,
            thread_id: None,
        };
        assert_eq!(start_run_response(&state, request, None).0, 503);
        let request = EnqueueRequest {
            prompt: "must not queue".into(),
            workspace: None,
            scheduled_for: None,
            channel_id: None,
            thread_id: None,
        };
        assert_eq!(enqueue_response(&state, request, None).0, 503);
        assert_eq!(
            update_admission_response(&state, "99999999-9999-9999-9999-999999999999", false).0,
            409
        );
        assert!(!state.accepting_work.load(Ordering::SeqCst));
        assert_eq!(update_admission_response(&state, token, false).0, 200);
        assert!(state.accepting_work.load(Ordering::SeqCst));
        fs::write(
            owned.data_paths.queue_dir.join("kept.json"),
            r#"{"id":"kept","status":"queued","prompt":"keep this"}"#,
        )
        .unwrap();
        assert_eq!(update_admission_response(&state, token, true).0, 409);
        assert!(state.accepting_work.load(Ordering::SeqCst));
        assert_eq!(
            read_queue_items(&owned.data_paths).unwrap()[0]
                .prompt
                .as_deref(),
            Some("keep this")
        );
        fs::remove_dir_all(paths.root).unwrap();
    }

    #[test]
    fn automatic_update_setting_gates_background_checks() {
        let root =
            std::env::temp_dir().join(format!("squad-update-setting-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        assert!(super::automatic_update_checks_enabled(&root));
        std::fs::write(
            root.join("settings.json"),
            r#"{"autoCheckUpdates":false,"other":true}"#,
        )
        .unwrap();
        assert!(!super::automatic_update_checks_enabled(&root));
        std::fs::write(root.join("settings.json"), r#"{"autoCheckUpdates":true}"#).unwrap();
        assert!(super::automatic_update_checks_enabled(&root));
        std::fs::write(root.join("settings.json"), "broken").unwrap();
        assert!(super::automatic_update_checks_enabled(&root));
        std::fs::remove_dir_all(root).unwrap();
    }

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
    fn bridge_supervisor_restarts_only_when_the_bridge_is_really_gone() {
        use super::{bridge_action, bridge_restart_backoff, BridgeAction};
        // No record: the person stopped the bridge; nothing to do.
        assert_eq!(
            bridge_action(false, true, false, false, 5),
            BridgeAction::Skip
        );
        // Draining daemon: a restart would fight the stop.
        assert_eq!(
            bridge_action(true, false, true, false, 5),
            BridgeAction::Skip
        );
        // Answering: healthy, whatever happened before.
        assert_eq!(
            bridge_action(true, true, true, true, 2),
            BridgeAction::Healthy
        );
        // Process gone: restart at once.
        assert!(matches!(
            bridge_action(true, true, false, false, 0),
            BridgeAction::Restart(_)
        ));
        // Alive but silent: wait a minute (twelve probes), then restart.
        assert_eq!(
            bridge_action(true, true, true, false, 0),
            BridgeAction::Wait
        );
        assert_eq!(
            bridge_action(true, true, true, false, 2),
            BridgeAction::Wait
        );
        assert_eq!(
            bridge_action(true, true, true, false, 10),
            BridgeAction::Wait
        );
        assert!(matches!(
            bridge_action(true, true, true, false, 11),
            BridgeAction::Restart(_)
        ));
        // Backoff doubles and caps at a minute.
        assert_eq!(bridge_restart_backoff(0).as_secs(), 5);
        assert_eq!(bridge_restart_backoff(1).as_secs(), 10);
        assert_eq!(bridge_restart_backoff(3).as_secs(), 40);
        assert_eq!(bridge_restart_backoff(9).as_secs(), 60);
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
        let mut record = new_run_record(
            &paths,
            RunRequest {
                prompt: "check status".to_string(),
                workspace: Some(paths.root.display().to_string()),
                agent_id: Some("agent-1".to_string()),
                extra_args: Some(vec!["--dry-run".to_string()]),
                harness: None,
                channel_id: None,
                thread_id: None,
            },
            "running",
        );
        record.daemon_instance_id = Some("fixture-instance".into());
        write_run_record(&paths, &record).unwrap();

        let state = AppState {
            paths: paths.clone(),
            account_email: Arc::new(StdMutex::new(None)),
            config: SquadConfig::defaults(),
            accepting_work: Arc::new(AtomicBool::new(true)),
            update_admission: Arc::new(StdMutex::new(None)),
            ownership_activity: Arc::new(OwnershipActivity::default()),
            instance_id: "fixture-instance".into(),
            native_recovery_confirmed: true,
            shutdown_tx: Arc::new(Mutex::new(None)),
            device_id: "device-1".to_string(),
            web_restarts: Arc::new(AtomicU64::new(0)),
        };
        let status = status_payload(&state);

        assert_eq!(read_run_records(&paths).unwrap().len(), 1);
        assert_eq!(
            metrics_for_paths(&paths, "fixture-instance", true).active_runs,
            1
        );
        assert_eq!(
            status.active_runs, 0,
            "legacy machine runs cannot become current-owner status"
        );
        assert_eq!(status.running_sessions, 0);
        assert!(status.ownership.is_none());
        assert_eq!(status.active_trigger_work, 0);
        assert_eq!(status.queue_depth, 0);
        let _ = fs::remove_dir_all(paths.root);
    }

    #[test]
    fn stale_run_projection_preserves_history_and_requires_cleanup_proof() {
        let paths = temp_state_paths();
        paths.ensure().unwrap();
        let mut record = new_run_record(
            &paths,
            RunRequest {
                prompt: "Historical work".into(),
                workspace: None,
                agent_id: Some("eva".into()),
                extra_args: None,
                harness: None,
                channel_id: None,
                thread_id: None,
            },
            "running",
        );
        record.daemon_instance_id = Some("previous-daemon".into());
        record.started_at = Some("2026-11-10T00:00:00Z".into());
        write_run_record(&paths, &record).unwrap();
        let before = fs::read(paths.runs_dir.join(format!("{}.json", record.id))).unwrap();
        let projected = project_run_record(record.clone(), "current-daemon", true);
        assert_eq!(projected.status, "interrupted");
        assert_eq!(
            projected.recovery_status.as_deref(),
            Some("previous-daemon")
        );
        assert_eq!(projected.started_at, record.started_at);
        assert_eq!(
            projected.completed_at, None,
            "a read does not invent a completion time"
        );
        assert_eq!(
            metrics_for_paths(&paths, "current-daemon", true).active_runs,
            0
        );
        assert_eq!(
            projected_run_records(&paths, "current-daemon", true).unwrap()[0],
            projected
        );
        assert_eq!(
            project_run_record(record.clone(), "current-daemon", false).status,
            "unknown"
        );
        assert_eq!(
            project_run_record(record.clone(), "previous-daemon", false),
            record
        );
        record.daemon_instance_id = None;
        assert_eq!(
            project_run_record(record.clone(), "current-daemon", true)
                .recovery_status
                .as_deref(),
            Some("legacy-execution-unverified")
        );
        record.status = "completed".into();
        assert_eq!(
            project_run_record(record.clone(), "current-daemon", true),
            record
        );
        assert_eq!(
            fs::read(paths.runs_dir.join(format!("{}.json", record.id))).unwrap(),
            before
        );
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
            update_admission: Arc::new(StdMutex::new(None)),
            ownership_activity: Arc::new(OwnershipActivity::default()),
            instance_id: "fixture-instance".into(),
            native_recovery_confirmed: true,
            shutdown_tx: Arc::new(Mutex::new(None)),
            device_id: "device-1".to_string(),
            web_restarts: Arc::new(AtomicU64::new(0)),
        };
        let locked = status_payload(&state);
        assert!(
            locked.members.is_empty(),
            "an unowned legacy snapshot must stay hidden"
        );
        let context = OwnedContext {
            credential_fingerprint: "fixture".into(),
            generation: "1234abcd-1234-4abc-8def-0123456789ab".into(),
            owner_key: "fixture-owner".into(),
            dataset_id: "6789abcd-1234-4abc-8def-0123456789ab".into(),
            actor: crate::ownership::Actor {
                issuer: "https://api.autohand.ai".into(),
                id: "alice".into(),
                email: "alice@example.test".into(),
            },
            owner: crate::ownership::Owner {
                kind: "user".into(),
                issuer: "https://api.autohand.ai".into(),
                id: "alice".into(),
            },
            can_write: true,
            data_paths: paths.clone(),
            app_root: paths.root.join("app"),
            workspace_root: paths.root.join("member-homes"),
        };
        let status = status_payload_for_context(&state, Some(&context));

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
        assert!(status.ownership.as_ref().unwrap().matches(&context));
        let mut reader = context.clone();
        reader.can_write = false;
        let passive = status_payload_for_context(&state, Some(&reader));
        assert_eq!(passive.active_runs, 0);
        assert_eq!(passive.members[0].working, false);
        assert_eq!(passive.members[0].status, "offline");
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
            update_admission: Arc::new(StdMutex::new(None)),
            ownership_activity: Arc::new(OwnershipActivity::default()),
            instance_id: "fixture-instance".into(),
            native_recovery_confirmed: true,
            shutdown_tx: Arc::new(Mutex::new(None)),
            device_id: "device-1".to_string(),
            web_restarts: Arc::new(AtomicU64::new(0)),
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
            current_account_email(&state).as_deref(),
            Some("ops@example.com")
        );
        assert_eq!(
            status_payload(&state).account.email,
            None,
            "an email label is not verified ownership"
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
        let fixture = crate::ownership::tests::Fixture::new();
        let _auth = fixture.authenticate();
        let paths = fixture.service.clone();
        let owned = read_active_context(&paths).unwrap().unwrap();
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
        let status: StatusResponse =
            local_json_request(&record, &owned.generation, "GET", "/status", None)
                .await
                .unwrap();
        assert!(status.success);
        assert!(status.accepting_work);

        let owner = r#"{"token":"01234567-0123-0123-0123-012345678901"}"#;
        let paused: serde_json::Value = local_json_request(
            &record,
            &owned.generation,
            "POST",
            "/updates/pause",
            Some(owner),
        )
        .await
        .unwrap();
        assert_eq!(paused["paused"], true);
        let refused_run: serde_json::Value = local_json_request(
            &record,
            &owned.generation,
            "POST",
            "/runs",
            Some(r#"{"prompt":"must not start"}"#),
        )
        .await
        .unwrap();
        assert_eq!(refused_run["status"], "rejected");
        let refused_queue: serde_json::Value = local_json_request(
            &record,
            &owned.generation,
            "POST",
            "/queue",
            Some(r#"{"prompt":"must not queue"}"#),
        )
        .await
        .unwrap();
        assert_eq!(refused_queue["status"], "rejected");
        let runs: RunsResponse =
            local_json_request(&record, &owned.generation, "GET", "/runs", None)
                .await
                .unwrap();
        assert!(runs.runs.is_empty());
        let resumed: serde_json::Value = local_json_request(
            &record,
            &owned.generation,
            "POST",
            "/updates/resume",
            Some(owner),
        )
        .await
        .unwrap();
        assert_eq!(resumed["paused"], false);

        let queued: QueueItem = local_json_request(
            &record,
            &owned.generation,
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

        let (sync_status, synced): (u16, ChannelsState) = local_json_response(
            &record,
            &owned.generation,
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
        assert_eq!(sync_status, 503, "canonical Node writer is unavailable");
        assert_eq!(synced.channels.len(), 1);
        assert!(
            !owned.data_paths.channels_json.exists(),
            "the native service cannot overwrite canonical channels without Node CAS"
        );
        // Stand in for the canonical Node writer for the remaining read/status
        // checks. The actual bridge's merge/CAS is covered by JS integration.
        crate::state::write_channels_state(&owned.data_paths, &synced).unwrap();

        let channels: ChannelsState =
            local_json_request(&record, &owned.generation, "GET", "/channels", None)
                .await
                .unwrap();
        assert_eq!(channels.channels[0].id, "channel_general");
        assert_eq!(channels.channels[0].visibility, "public");
        assert!(!channels.channels[0].auto_mode_default);
        assert_eq!(channels.threads.len(), 1);

        let status_with_channels: StatusResponse =
            local_json_request(&record, &owned.generation, "GET", "/status", None)
                .await
                .unwrap();
        assert_eq!(status_with_channels.channels, 1);
        assert_eq!(status_with_channels.channel_threads, 1);

        let sync: SyncSnapshot =
            local_json_request(&record, &owned.generation, "POST", "/sync", Some(""))
                .await
                .unwrap();
        assert!(sync.success);
        assert_eq!(sync.queue_depth, 1);

        let mut active_record = new_run_record(
            &owned.data_paths,
            RunRequest {
                prompt: "finish before restart".to_string(),
                workspace: Some(paths.root.display().to_string()),
                agent_id: Some("agent-1".to_string()),
                extra_args: None,
                harness: None,
                channel_id: None,
                thread_id: None,
            },
            "running",
        );
        active_record.daemon_instance_id = Some(format!("{}:{}", record.pid, record.started_at));
        write_run_record(&owned.data_paths, &active_record).unwrap();

        let restart: LifecycleResponse =
            local_json_request(&record, &owned.generation, "POST", "/restart", Some(""))
                .await
                .unwrap();
        assert!(restart.success);
        // No actual writer was admitted for the hand-written historical row.
        // Durable records are not a substitute for an activity/process drain.
        let result = tokio::time::timeout(Duration::from_secs(5), handle)
            .await
            .unwrap()
            .unwrap();
        assert!(result.is_ok());
        assert_eq!(
            read_run_record(&owned.data_paths, &active_record.id)
                .unwrap()
                .unwrap()
                .status,
            "running",
            "restart does not fabricate a final history record"
        );
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
        generation: &str,
        method: &str,
        path: &str,
        body: Option<&str>,
    ) -> Result<T>
    where
        T: DeserializeOwned,
    {
        Ok(local_json_response(record, generation, method, path, body)
            .await?
            .1)
    }

    async fn local_json_response<T>(
        record: &DaemonRecord,
        generation: &str,
        method: &str,
        path: &str,
        body: Option<&str>,
    ) -> Result<(u16, T)>
    where
        T: DeserializeOwned,
    {
        let mut stream = TcpStream::connect((record.host.as_str(), record.port)).await?;
        let body = body.unwrap_or("");
        let request = format!(
            "{method} {path} HTTP/1.1\r\nHost: {}:{}\r\nX-Squad-Context: {generation}\r\nAccept: application/json\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            record.host,
            record.port,
            body.len(),
            body
        );
        stream.write_all(request.as_bytes()).await?;
        let mut response = String::new();
        stream.read_to_string(&mut response).await?;
        let (headers, body) = response
            .split_once("\r\n\r\n")
            .ok_or_else(|| anyhow::anyhow!("invalid HTTP response"))?;
        let status = headers.split_whitespace().nth(1).unwrap().parse()?;
        Ok((status, serde_json::from_str(body)?))
    }
}
