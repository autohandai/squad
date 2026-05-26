use crate::config::SquadConfig;
use crate::state::now_string;
use crate::telemetry::{TelemetryEvent, DAEMON_SURFACE, SQUAD_CLIENT_TYPE};
use crate::VERSION;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::env::consts::{ARCH, OS};

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
}

impl ApiClient {
    pub fn new(config: SquadConfig, device_id: impl Into<String>) -> Self {
        Self {
            client: reqwest::Client::new(),
            config,
            device_id: device_id.into(),
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

        match self.post_json("/v1/squad/devices/register", &request).await {
            Ok(status) => {
                snapshot.success = true;
                snapshot.remote_status = Some(status);
            }
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

        match self.post_json("/v1/squad/pings", &request).await {
            Ok(status) => {
                snapshot.success = true;
                snapshot.remote_status = Some(status);
            }
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
            remote_status: None,
            remote_error: None,
        };

        let path = format!(
            "/v1/squad/feature-flags?clientType={}&surface={}&deviceId={}&version={}",
            SQUAD_CLIENT_TYPE, DAEMON_SURFACE, self.device_id, VERSION
        );
        match self.get_json(&path).await {
            Ok((status, payload)) => {
                snapshot.success = true;
                snapshot.remote_status = Some(status);
                snapshot.flags = parse_feature_flags(&payload);
            }
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
            events_sent: events.len(),
            remote_status: None,
            remote_error: None,
        };

        if events.is_empty() {
            snapshot.success = true;
            return snapshot;
        }

        let request = TelemetryFlushRequest {
            client_type: SQUAD_CLIENT_TYPE,
            surface: DAEMON_SURFACE,
            version: VERSION,
            device_id: &self.device_id,
            events,
        };

        match self.post_json("/v1/squad/telemetry", &request).await {
            Ok(status) => {
                snapshot.success = true;
                snapshot.remote_status = Some(status);
            }
            Err(error) => snapshot.remote_error = Some(error.to_string()),
        }
        snapshot
    }

    async fn post_json<T: Serialize + ?Sized>(&self, path: &str, body: &T) -> Result<u16> {
        if !self.remote_enabled() {
            bail!(
                "remote API disabled: apiBaseUrl is not HTTP(S) ({})",
                self.config.api_base_url
            );
        }
        let response = self
            .authorized(self.client.post(self.url(path)?))
            .json(body)
            .send()
            .await
            .with_context(|| format!("POST {path}"))?;
        let status = response.status();
        if !status.is_success() {
            bail!("POST {path} failed with HTTP {}", status.as_u16());
        }
        Ok(status.as_u16())
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
