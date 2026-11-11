use crate::config::SquadConfig;
use crate::state::now_string;
use crate::telemetry::{TelemetryEvent, DAEMON_SURFACE, SQUAD_CLIENT_TYPE};
use crate::VERSION;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::env::consts::{ARCH, OS};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

/// Optional legacy endpoints may not be installed on a Squad deployment.
/// Re-probe after an hour (or a daemon restart), so deployment can add them.
const UNSUPPORTED_RETRY_AFTER: Duration = Duration::from_secs(60 * 60);

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RemoteState {
    #[default]
    Unknown,
    Available,
    Unsupported,
    Disabled,
    Idle,
    Failed,
}

#[derive(Clone, Hash, PartialEq, Eq)]
struct EndpointKey {
    scope: [u8; 32],
    path: &'static str,
}
type UnsupportedEndpoints = Arc<Mutex<HashMap<EndpointKey, (Instant, u16)>>>;
static OPTIONAL_ENDPOINTS: OnceLock<UnsupportedEndpoints> = OnceLock::new();

enum OptionalResponse {
    Available(reqwest::Response),
    Unsupported(u16),
    Disabled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteMetrics {
    pub queue_depth: usize,
    pub queued_jobs: usize,
    pub scheduled_jobs: usize,
    pub active_work: usize,
    pub online_members: usize,
    pub working_agents: usize,
    pub run_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceRegistrationSnapshot {
    pub success: bool,
    pub registered_at: String,
    pub api_base_url: String,
    pub client_type: String,
    pub surface: String,
    pub version: String,
    pub device_id: String,
    pub os: String,
    pub arch: String,
    pub host: String,
    pub port: u16,
    pub open_url: String,
    pub account_email: Option<String>,
    pub plan_state: String,
    pub update_channel: String,
    pub launch_at_login_policy: String,
    pub telemetry_policy: String,
    #[serde(default)]
    pub remote_state: RemoteState,
    pub remote_status: Option<u16>,
    pub remote_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PingSnapshot {
    pub success: bool,
    pub pinged_at: String,
    pub api_base_url: String,
    pub client_type: String,
    pub surface: String,
    pub version: String,
    pub device_id: String,
    pub metrics: RemoteMetrics,
    pub plan_state: String,
    #[serde(default)]
    pub remote_state: RemoteState,
    pub remote_status: Option<u16>,
    pub remote_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FeatureFlagState {
    pub key: String,
    pub enabled: bool,
    pub variant: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FeatureFlagSnapshot {
    pub success: bool,
    pub checked_at: String,
    pub api_base_url: String,
    pub client_type: String,
    pub surface: String,
    pub version: String,
    pub device_id: String,
    pub flags: Vec<FeatureFlagState>,
    #[serde(default)]
    pub remote_state: RemoteState,
    pub remote_status: Option<u16>,
    pub remote_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryFlushSnapshot {
    pub success: bool,
    pub flushed_at: String,
    pub api_base_url: String,
    pub client_type: String,
    pub surface: String,
    pub version: String,
    pub device_id: String,
    pub events_sent: usize,
    #[serde(default)]
    pub remote_state: RemoteState,
    pub remote_status: Option<u16>,
    pub remote_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceRegistrationRequest<'a> {
    client_type: &'a str,
    surface: &'a str,
    version: &'a str,
    device_id: &'a str,
    os: &'a str,
    arch: &'a str,
    host: &'a str,
    port: u16,
    open_url: &'a str,
    account_email: Option<&'a str>,
    plan_state: &'a str,
    update_channel: &'a str,
    launch_at_login_policy: &'a str,
    telemetry_policy: &'a str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PingRequest<'a> {
    client_type: &'a str,
    surface: &'a str,
    version: &'a str,
    device_id: &'a str,
    metrics: &'a RemoteMetrics,
    plan_state: &'a str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TelemetryFlushRequest<'a> {
    client_type: &'a str,
    surface: &'a str,
    version: &'a str,
    device_id: &'a str,
    events: &'a [TelemetryEvent],
}

#[derive(Clone)]
pub struct ApiClient {
    client: reqwest::Client,
    config: SquadConfig,
    device_id: String,
    unsupported: UnsupportedEndpoints,
    support_scope: [u8; 32],
}

impl ApiClient {
    pub fn new(config: SquadConfig, device_id: impl Into<String>) -> Self {
        let device_id = device_id.into();
        // Only support state is shared. Credentials/configuration are captured
        // anew for each operation, including an owned account transition.
        let mut scope = Sha256::new();
        for value in [
            config.api_base_url.as_str(),
            config.api_auth_token.as_deref().unwrap_or(""),
            config.company_secret.as_deref().unwrap_or(""),
            config.account_email.as_deref().unwrap_or(""),
            device_id.as_str(),
        ] {
            scope.update((value.len() as u64).to_le_bytes());
            scope.update(value.as_bytes());
        }
        Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .expect("build daemon HTTP client"),
            config,
            device_id,
            support_scope: scope.finalize().into(),
            unsupported: OPTIONAL_ENDPOINTS.get_or_init(Default::default).clone(),
        }
    }

    pub fn remote_enabled(&self) -> bool {
        self.config.api_base_url.starts_with("http://")
            || self.config.api_base_url.starts_with("https://")
    }

    pub async fn register_device(&self) -> DeviceRegistrationSnapshot {
        let mut snapshot = DeviceRegistrationSnapshot {
            success: false,
            registered_at: now_string(),
            api_base_url: self.config.api_base_url.clone(),
            client_type: SQUAD_CLIENT_TYPE.to_string(),
            surface: DAEMON_SURFACE.to_string(),
            version: VERSION.to_string(),
            device_id: self.device_id.clone(),
            os: OS.to_string(),
            arch: ARCH.to_string(),
            host: self.config.host.clone(),
            port: self.config.port,
            open_url: self.config.open_url.clone(),
            account_email: self.config.account_email.clone(),
            plan_state: self.config.plan_state.clone(),
            update_channel: self.config.update_channel.clone(),
            launch_at_login_policy: self.config.launch_at_login_policy.clone(),
            telemetry_policy: self.config.telemetry_policy.clone(),
            remote_state: RemoteState::Failed,
            remote_status: None,
            remote_error: None,
        };

        let request = DeviceRegistrationRequest {
            client_type: SQUAD_CLIENT_TYPE,
            surface: DAEMON_SURFACE,
            version: VERSION,
            device_id: &self.device_id,
            os: OS,
            arch: ARCH,
            host: &self.config.host,
            port: self.config.port,
            open_url: &self.config.open_url,
            account_email: self.config.account_email.as_deref(),
            plan_state: &self.config.plan_state,
            update_channel: &self.config.update_channel,
            launch_at_login_policy: &self.config.launch_at_login_policy,
            telemetry_policy: &self.config.telemetry_policy,
        };

        match self
            .optional_post_json("/v1/squad/devices/register", &request)
            .await
        {
            Ok(OptionalResponse::Available(response)) => {
                snapshot.success = true;
                snapshot.remote_state = RemoteState::Available;
                snapshot.remote_status = Some(response.status().as_u16());
            }
            Ok(OptionalResponse::Unsupported(status)) => {
                snapshot.remote_state = RemoteState::Unsupported;
                snapshot.remote_status = Some(status);
            }
            Ok(OptionalResponse::Disabled) => snapshot.remote_state = RemoteState::Disabled,
            Err(error) => snapshot.remote_error = Some(error.to_string()),
        }
        snapshot
    }

    pub async fn send_ping(&self, metrics: RemoteMetrics) -> PingSnapshot {
        let mut snapshot = PingSnapshot {
            success: false,
            pinged_at: now_string(),
            api_base_url: self.config.api_base_url.clone(),
            client_type: SQUAD_CLIENT_TYPE.to_string(),
            surface: DAEMON_SURFACE.to_string(),
            version: VERSION.to_string(),
            device_id: self.device_id.clone(),
            metrics,
            plan_state: self.config.plan_state.clone(),
            remote_state: RemoteState::Failed,
            remote_status: None,
            remote_error: None,
        };

        let request = PingRequest {
            client_type: SQUAD_CLIENT_TYPE,
            surface: DAEMON_SURFACE,
            version: VERSION,
            device_id: &self.device_id,
            metrics: &snapshot.metrics,
            plan_state: &self.config.plan_state,
        };

        match self.optional_post_json("/v1/squad/pings", &request).await {
            Ok(OptionalResponse::Available(response)) => {
                snapshot.success = true;
                snapshot.remote_state = RemoteState::Available;
                snapshot.remote_status = Some(response.status().as_u16());
            }
            Ok(OptionalResponse::Unsupported(status)) => {
                snapshot.remote_state = RemoteState::Unsupported;
                snapshot.remote_status = Some(status);
            }
            Ok(OptionalResponse::Disabled) => snapshot.remote_state = RemoteState::Disabled,
            Err(error) => snapshot.remote_error = Some(error.to_string()),
        }
        snapshot
    }

    pub async fn fetch_feature_flags(&self) -> FeatureFlagSnapshot {
        let mut snapshot = FeatureFlagSnapshot {
            success: false,
            checked_at: now_string(),
            api_base_url: self.config.api_base_url.clone(),
            client_type: SQUAD_CLIENT_TYPE.to_string(),
            surface: DAEMON_SURFACE.to_string(),
            version: VERSION.to_string(),
            device_id: self.device_id.clone(),
            flags: Vec::new(),
            remote_state: RemoteState::Failed,
            remote_status: None,
            remote_error: None,
        };

        let path = format!(
            "/v1/squad/feature-flags?clientType={}&surface={}&deviceId={}&version={}",
            SQUAD_CLIENT_TYPE, DAEMON_SURFACE, self.device_id, VERSION
        );
        let request = self
            .client
            .get(self.url(&path).expect("build feature flag URL"));
        match self
            .optional_request("/v1/squad/feature-flags", request)
            .await
        {
            Ok(OptionalResponse::Available(response)) => {
                snapshot.remote_status = Some(response.status().as_u16());
                match response.json::<Value>().await {
                    Ok(payload) => {
                        snapshot.success = true;
                        snapshot.remote_state = RemoteState::Available;
                        snapshot.flags = parse_feature_flags(&payload);
                    }
                    Err(error) => {
                        snapshot.remote_error = Some(format!("parse feature flags: {error}"))
                    }
                }
            }
            Ok(OptionalResponse::Unsupported(status)) => {
                snapshot.remote_state = RemoteState::Unsupported;
                snapshot.remote_status = Some(status);
            }
            Ok(OptionalResponse::Disabled) => snapshot.remote_state = RemoteState::Disabled,
            Err(error) => snapshot.remote_error = Some(error.to_string()),
        }
        snapshot
    }

    pub async fn get_release_manifest(&self) -> Result<(u16, Value, String)> {
        let path = format!(
            "/v1/squad/releases/{}/manifest?clientType={}&surface={}&deviceId={}&version={}",
            self.config.update_channel, SQUAD_CLIENT_TYPE, DAEMON_SURFACE, self.device_id, VERSION
        );
        let url = self.url(&path)?;
        let (status, payload) = self.get_json(&path).await?;
        Ok((status, payload, url))
    }

    pub async fn send_telemetry_batch(&self, events: &[TelemetryEvent]) -> TelemetryFlushSnapshot {
        let mut snapshot = TelemetryFlushSnapshot {
            success: false,
            flushed_at: now_string(),
            api_base_url: self.config.api_base_url.clone(),
            client_type: SQUAD_CLIENT_TYPE.to_string(),
            surface: DAEMON_SURFACE.to_string(),
            version: VERSION.to_string(),
            device_id: self.device_id.clone(),
            events_sent: 0,
            remote_state: RemoteState::Failed,
            remote_status: None,
            remote_error: None,
        };

        if !self.config.telemetry_enabled() || !self.remote_enabled() {
            snapshot.remote_state = RemoteState::Disabled;
            return snapshot;
        }
        if events.is_empty() {
            snapshot.success = true;
            snapshot.remote_state = RemoteState::Idle;
            return snapshot;
        }

        let request = TelemetryFlushRequest {
            client_type: SQUAD_CLIENT_TYPE,
            surface: DAEMON_SURFACE,
            version: VERSION,
            device_id: &self.device_id,
            events,
        };

        match self
            .optional_post_json("/v1/squad/telemetry", &request)
            .await
        {
            Ok(OptionalResponse::Available(response)) => {
                snapshot.success = true;
                snapshot.remote_state = RemoteState::Available;
                snapshot.remote_status = Some(response.status().as_u16());
                snapshot.events_sent = events.len();
            }
            Ok(OptionalResponse::Unsupported(status)) => {
                snapshot.remote_state = RemoteState::Unsupported;
                snapshot.remote_status = Some(status);
            }
            Ok(OptionalResponse::Disabled) => snapshot.remote_state = RemoteState::Disabled,
            Err(error) => snapshot.remote_error = Some(error.to_string()),
        }
        snapshot
    }

    async fn optional_post_json<T: Serialize + ?Sized>(
        &self,
        path: &'static str,
        body: &T,
    ) -> Result<OptionalResponse> {
        self.optional_request(path, self.client.post(self.url(path)?).json(body))
            .await
    }

    async fn optional_request(
        &self,
        endpoint: &'static str,
        request: reqwest::RequestBuilder,
    ) -> Result<OptionalResponse> {
        if !self.remote_enabled() {
            return Ok(OptionalResponse::Disabled);
        }
        // Keep admission and the probe together: clones/manual checks must not
        // race and send the same missing endpoint repeatedly.
        let mut unsupported = self.unsupported.lock().await;
        unsupported.retain(|_, (checked, _)| checked.elapsed() < UNSUPPORTED_RETRY_AFTER);
        let key = self.endpoint_key(endpoint);
        if let Some((checked, status)) = unsupported.get(&key) {
            if checked.elapsed() < UNSUPPORTED_RETRY_AFTER {
                return Ok(OptionalResponse::Unsupported(*status));
            }
        }
        let response = self
            .authorized(request)
            .send()
            .await
            .with_context(|| format!("request {endpoint}"))?;
        let status = response.status();
        if matches!(status.as_u16(), 404 | 405 | 501) {
            unsupported.insert(key, (Instant::now(), status.as_u16()));
            return Ok(OptionalResponse::Unsupported(status.as_u16()));
        }
        unsupported.remove(&key);
        if !status.is_success() {
            bail!("request {endpoint} failed with HTTP {}", status.as_u16());
        }
        Ok(OptionalResponse::Available(response))
    }

    fn endpoint_key(&self, path: &'static str) -> EndpointKey {
        EndpointKey {
            scope: self.support_scope,
            path,
        }
    }

    async fn get_json(&self, path: &str) -> Result<(u16, Value)> {
        if !self.remote_enabled() {
            bail!(
                "remote API disabled: apiBaseUrl is not HTTP(S) ({})",
                self.config.api_base_url
            );
        }
        let response = self
            .authorized(self.client.get(self.url(path)?))
            .send()
            .await
            .with_context(|| format!("GET {path}"))?;
        let status = response.status();
        if !status.is_success() {
            bail!("GET {path} failed with HTTP {}", status.as_u16());
        }
        let body = response
            .json::<Value>()
            .await
            .with_context(|| format!("parse {path} response"))?;
        Ok((status.as_u16(), body))
    }

    fn authorized(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        let request = if let Some(token) = self.config.api_auth_token.as_deref() {
            request.bearer_auth(token)
        } else {
            request
        };
        if let Some(secret) = self.config.company_secret.as_deref() {
            request.header("x-autohand-company-secret", secret)
        } else {
            request
        }
    }

    fn url(&self, path: &str) -> Result<String> {
        if path.starts_with("http://") || path.starts_with("https://") {
            return Ok(path.to_string());
        }
        Ok(format!(
            "{}{}",
            self.config.api_base_url.trim_end_matches('/'),
            path
        ))
    }
}

pub fn parse_feature_flags(payload: &Value) -> Vec<FeatureFlagState> {
    let mut flags = Vec::new();
    for key in ["featureFlags", "flags"] {
        if let Some(value) = payload.get(key) {
            collect_flags(value, &mut flags);
        }
    }
    flags.sort_by(|a, b| a.key.cmp(&b.key));
    flags.dedup_by(|a, b| a.key == b.key);
    flags
}

fn collect_flags(value: &Value, flags: &mut Vec<FeatureFlagState>) {
    match value {
        Value::Object(map) => {
            for (key, value) in map {
                let enabled = value
                    .as_bool()
                    .or_else(|| value.get("enabled").and_then(Value::as_bool))
                    .unwrap_or(false);
                let variant = value
                    .get("variant")
                    .or_else(|| value.get("value"))
                    .and_then(Value::as_str)
                    .map(ToString::to_string);
                flags.push(FeatureFlagState {
                    key: key.clone(),
                    enabled,
                    variant,
                });
            }
        }
        Value::Array(items) => {
            for item in items {
                let Some(key) = item
                    .get("key")
                    .or_else(|| item.get("flag"))
                    .and_then(Value::as_str)
                else {
                    continue;
                };
                flags.push(FeatureFlagState {
                    key: key.to_string(),
                    enabled: item
                        .get("enabled")
                        .or_else(|| item.get("value"))
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    variant: item
                        .get("variant")
                        .or_else(|| item.get("value"))
                        .and_then(Value::as_str)
                        .map(ToString::to_string),
                });
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    async fn fixture(
        status: u16,
        payload: &'static str,
    ) -> (
        ApiClient,
        Arc<std::sync::atomic::AtomicUsize>,
        tokio::task::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut config = SquadConfig::defaults();
        config.api_base_url = format!("http://{}", listener.local_addr().unwrap());
        let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let observed = count.clone();
        let server = tokio::spawn(async move {
            loop {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                loop {
                    let mut buffer = [0; 4096];
                    let read = stream.read(&mut buffer).await.unwrap();
                    if read == 0 {
                        break;
                    }
                    bytes.extend_from_slice(&buffer[..read]);
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
                observed.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let response = format!("HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}", payload.len());
                stream.write_all(response.as_bytes()).await.unwrap();
            }
        });
        (ApiClient::new(config, "fixture"), count, server)
    }

    #[tokio::test]
    async fn unsupported_probes_are_shared_bounded_and_scoped_to_an_endpoint() {
        for status in [404, 405, 501] {
            let (api, count, server) = fixture(status, "{}").await;
            assert_eq!(
                api.register_device().await.remote_state,
                RemoteState::Unsupported
            );
            let clone = api.clone();
            assert_eq!(clone.register_device().await.remote_status, Some(status));
            assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 1);
            assert_eq!(
                clone.fetch_feature_flags().await.remote_state,
                RemoteState::Unsupported
            );
            assert_eq!(
                count.load(std::sync::atomic::Ordering::SeqCst),
                2,
                "registration cannot disable flags"
            );
            api.unsupported
                .lock()
                .await
                .get_mut(&api.endpoint_key("/v1/squad/devices/register"))
                .unwrap()
                .0 = Instant::now() - UNSUPPORTED_RETRY_AFTER;
            api.register_device().await;
            assert_eq!(
                count.load(std::sync::atomic::Ordering::SeqCst),
                3,
                "an added route must be discovered after the cooldown"
            );
            // Another identity gets its own probe; a recreated client in the
            // same identity must retain the support result across cycles.
            ApiClient::new(api.config.clone(), "fixture")
                .register_device()
                .await;
            assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 3);
            ApiClient::new(api.config.clone(), "another-device")
                .register_device()
                .await;
            assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 4);
            let mut credentials = api.config.clone();
            credentials.api_auth_token = Some("fixture-other-session".into());
            ApiClient::new(credentials.clone(), "fixture")
                .register_device()
                .await;
            assert_eq!(
                count.load(std::sync::atomic::Ordering::SeqCst),
                5,
                "another credential must not inherit an unsupported result"
            );
            credentials.account_email = Some("other-owner@example.test".into());
            ApiClient::new(credentials, "fixture")
                .register_device()
                .await;
            assert_eq!(
                count.load(std::sync::atomic::Ordering::SeqCst),
                6,
                "another account must probe independently"
            );
            server.abort();
        }
    }

    #[tokio::test]
    async fn authentication_limits_and_outages_remain_failures_and_retry() {
        for status in [401, 403, 429, 500, 503] {
            let (api, count, server) = fixture(status, "{}").await;
            for _ in 0..2 {
                let snapshot = api.register_device().await;
                assert!(!snapshot.success);
                assert_eq!(snapshot.remote_state, RemoteState::Failed);
                assert!(snapshot
                    .remote_error
                    .unwrap()
                    .contains(&format!("HTTP {status}")));
            }
            assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 2);
            server.abort();
        }
    }

    #[tokio::test]
    async fn supported_flags_and_telemetry_report_real_results() {
        let (api, count, server) = fixture(200, r#"{"flags":{"actual_flag":true}}"#).await;
        let flags = api.fetch_feature_flags().await;
        assert!(flags.success);
        assert_eq!(flags.remote_state, RemoteState::Available);
        assert_eq!(
            flags.flags,
            vec![FeatureFlagState {
                key: "actual_flag".into(),
                enabled: true,
                variant: None
            }]
        );
        let telemetry = api
            .send_telemetry_batch(&[TelemetryEvent::new("fixture")])
            .await;
        assert!(telemetry.success);
        assert_eq!(telemetry.events_sent, 1);
        assert_eq!(
            api.send_telemetry_batch(&[]).await.remote_state,
            RemoteState::Idle
        );
        let mut disabled = api.config.clone();
        disabled.telemetry_policy = "disabled".into();
        let skipped = ApiClient::new(disabled, "fixture")
            .send_telemetry_batch(&[TelemetryEvent::new("must-not-send")])
            .await;
        assert_eq!(skipped.remote_state, RemoteState::Disabled);
        assert_eq!(skipped.events_sent, 0);
        assert!(skipped.remote_error.is_none());
        assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 2);
        server.abort();
    }

    #[tokio::test]
    async fn malformed_flags_and_connection_failures_are_not_unsupported() {
        let (api, _, server) = fixture(200, "not json").await;
        let flags = api.fetch_feature_flags().await;
        assert_eq!(flags.remote_state, RemoteState::Failed);
        assert!(!flags.success);
        assert!(flags.remote_error.is_some());
        server.abort();
        let _ = server.await;
        let registration = api.register_device().await;
        assert_eq!(registration.remote_state, RemoteState::Failed);
        assert!(registration.remote_error.is_some());
        assert!(!api
            .unsupported
            .lock()
            .await
            .contains_key(&api.endpoint_key("/v1/squad/devices/register")));
    }

    #[test]
    fn parses_feature_flags_from_object_and_array_payloads() {
        let flags = parse_feature_flags(&json!({
            "featureFlags": {
                "squad_daemon": { "enabled": true, "variant": "enabled" },
                "other": false
            },
            "flags": [
                { "key": "windows_tray", "enabled": true },
                { "flag": "linux_appindicator", "value": true, "variant": "appindicator" }
            ]
        }));

        assert_eq!(flags.len(), 4);
        assert!(flags
            .iter()
            .any(|flag| flag.key == "squad_daemon" && flag.enabled));
        assert!(flags
            .iter()
            .any(|flag| flag.key == "windows_tray" && flag.enabled));
        assert!(flags.iter().any(|flag| flag.key == "linux_appindicator"
            && flag.variant.as_deref() == Some("appindicator")));
    }
}
