use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const DEFAULT_HOST: &str = "127.0.0.1";
pub const DEFAULT_PORT: u16 = 19821;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatePaths {
    pub root: PathBuf,
    pub bin_dir: PathBuf,
    pub queue_dir: PathBuf,
    pub runs_dir: PathBuf,
    pub config_json: PathBuf,
    pub daemon_json: PathBuf,
    pub install_json: PathBuf,
    pub device_id: PathBuf,
    pub server_log: PathBuf,
    pub telemetry_log: PathBuf,
    pub device_registration_json: PathBuf,
    pub ping_json: PathBuf,
    pub feature_flags_json: PathBuf,
    pub telemetry_flush_json: PathBuf,
    pub sync_json: PathBuf,
    pub update_json: PathBuf,
    pub analytics_json: PathBuf,
    pub analytics_log: PathBuf,
    pub analytics_snapshot_json: PathBuf,
    pub web_server_json: PathBuf,
    pub web_server_log: PathBuf,
    pub web_status_json: PathBuf,
    pub channels_json: PathBuf,
    pub tray_json: PathBuf,
    pub tray_log: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InstallRecord {
    pub version: String,
    pub channel: String,
    pub installed_at: String,
    pub artifact_url: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DaemonRecord {
    pub pid: u32,
    pub host: String,
    pub port: u16,
    pub url: String,
    pub accepting_work: bool,
    pub started_at: String,
    pub drain_requested_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsRecord {
    pub pid: u32,
    pub host: String,
    pub port: u16,
    pub url: String,
    pub started_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WebServerRecord {
    pub pid: u32,
    pub host: String,
    pub port: u16,
    pub url: String,
    pub server_path: String,
    pub dev: bool,
    pub started_at: String,
}

fn default_channel_visibility() -> String {
    "public".to_string()
}

/// Squad channel metadata mirrored from the web app's channels.json so the
/// daemon can surface channel/thread state in queue/run telemetry across
/// restarts. Auto mode (self-judge) defaults OFF: absent fields deserialize
/// to `false`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChannelRecord {
    pub id: String,
    pub name: String,
    #[serde(default = "default_channel_visibility")]
    pub visibility: String,
    #[serde(default)]
    pub member_ids: Vec<String>,
    #[serde(default)]
    pub creator_id: String,
    #[serde(default)]
    pub auto_mode_default: bool,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChannelThreadRecord {
    pub id: String,
    pub channel_id: String,
    #[serde(default)]
    pub parent_message_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub creator_id: String,
    #[serde(default)]
    pub member_ids: Vec<String>,
    #[serde(default)]
    pub auto_mode: bool,
    #[serde(default)]
    pub self_judge: bool,
    #[serde(default)]
    pub reply_count: usize,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChannelsState {
    #[serde(default)]
    pub channels: Vec<ChannelRecord>,
    #[serde(default)]
    pub threads: Vec<ChannelThreadRecord>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrayRecord {
    pub pid: u32,
    pub host: String,
    pub daemon_port: u16,
    pub open_url: String,
    pub started_at: String,
}

impl StatePaths {
    pub fn from_root(root: impl Into<PathBuf>) -> Self {
        let root = root.into();
        Self {
            bin_dir: root.join("bin"),
            queue_dir: root.join("queue"),
            runs_dir: root.join("runs"),
            config_json: root.join("config.json"),
            daemon_json: root.join("daemon.json"),
            install_json: root.join("install.json"),
            device_id: root.join("device-id"),
            server_log: root.join("server.log"),
            telemetry_log: root.join("telemetry.jsonl"),
            device_registration_json: root.join("device-registration.json"),
            ping_json: root.join("ping.json"),
            feature_flags_json: root.join("feature-flags.json"),
            telemetry_flush_json: root.join("telemetry-flush.json"),
            sync_json: root.join("sync.json"),
            update_json: root.join("update.json"),
            analytics_json: root.join("analytics.json"),
            analytics_log: root.join("analytics.log"),
            analytics_snapshot_json: root.join("analytics-snapshot.json"),
            web_server_json: root.join("web-server.json"),
            web_server_log: root.join("web-server.log"),
            web_status_json: root.join("web-status.json"),
            channels_json: root.join("channels.json"),
            tray_json: root.join("tray.json"),
            tray_log: root.join("tray.log"),
            root,
        }
    }

    pub fn ensure(&self) -> Result<()> {
        fs::create_dir_all(&self.bin_dir)
            .with_context(|| format!("create {}", self.bin_dir.display()))?;
        fs::create_dir_all(&self.queue_dir)
            .with_context(|| format!("create {}", self.queue_dir.display()))?;
        fs::create_dir_all(&self.runs_dir)
            .with_context(|| format!("create {}", self.runs_dir.display()))?;
        Ok(())
    }
}

pub fn default_state_root() -> PathBuf {
    if let Ok(value) = env::var("AUTOHAND_SQUAD_HOME") {
        if !value.trim().is_empty() {
            return PathBuf::from(value);
        }
    }

    let autohand_home = env::var("AUTOHAND_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            ["HOME", "USERPROFILE"]
                .into_iter()
                .find_map(|name| {
                    env::var(name)
                        .ok()
                        .filter(|value| !value.trim().is_empty())
                        .map(PathBuf::from)
                })
                .map(|home| home.join(".autohand"))
                .unwrap_or_else(|| PathBuf::from(".autohand"))
        });

    autohand_home.join("squad")
}

pub fn default_state_paths() -> StatePaths {
    StatePaths::from_root(default_state_root())
}

pub fn ensure_device_id(paths: &StatePaths) -> Result<String> {
    paths.ensure()?;
    if paths.device_id.exists() {
        let existing = fs::read_to_string(&paths.device_id)
            .with_context(|| format!("read {}", paths.device_id.display()))?
            .trim()
            .to_string();
        if !existing.is_empty() {
            return Ok(existing);
        }
    }

    let next = format!("device-{}-{}", std::process::id(), now_millis());
    fs::write(&paths.device_id, &next)
        .with_context(|| format!("write {}", paths.device_id.display()))?;
    Ok(next)
}

pub fn now_string() -> String {
    let millis = now_millis();
    format!("unix-ms:{millis}")
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub fn read_install_record(paths: &StatePaths) -> Result<Option<InstallRecord>> {
    read_json_file(&paths.install_json)
}

pub fn write_install_record(paths: &StatePaths, record: &InstallRecord) -> Result<()> {
    paths.ensure()?;
    write_json_file(&paths.install_json, record)
}

pub fn read_daemon_record(paths: &StatePaths) -> Result<Option<DaemonRecord>> {
    read_json_file(&paths.daemon_json)
}

pub fn write_daemon_record(paths: &StatePaths, record: &DaemonRecord) -> Result<()> {
    paths.ensure()?;
    write_json_file(&paths.daemon_json, record)
}

pub fn remove_daemon_record(paths: &StatePaths) -> Result<()> {
    if paths.daemon_json.exists() {
        fs::remove_file(&paths.daemon_json)
            .with_context(|| format!("remove {}", paths.daemon_json.display()))?;
    }
    Ok(())
}

pub fn read_analytics_record(paths: &StatePaths) -> Result<Option<AnalyticsRecord>> {
    read_json_file(&paths.analytics_json)
}

pub fn write_analytics_record(paths: &StatePaths, record: &AnalyticsRecord) -> Result<()> {
    paths.ensure()?;
    write_json_file(&paths.analytics_json, record)
}

pub fn remove_analytics_record(paths: &StatePaths) -> Result<()> {
    if paths.analytics_json.exists() {
        fs::remove_file(&paths.analytics_json)
            .with_context(|| format!("remove {}", paths.analytics_json.display()))?;
    }
    Ok(())
}

pub fn read_web_server_record(paths: &StatePaths) -> Result<Option<WebServerRecord>> {
    read_json_file(&paths.web_server_json)
}

pub fn write_web_server_record(paths: &StatePaths, record: &WebServerRecord) -> Result<()> {
    paths.ensure()?;
    write_json_file(&paths.web_server_json, record)
}

pub fn remove_web_server_record(paths: &StatePaths) -> Result<()> {
    if paths.web_server_json.exists() {
        fs::remove_file(&paths.web_server_json)
            .with_context(|| format!("remove {}", paths.web_server_json.display()))?;
    }
    Ok(())
}

pub fn read_channels_state(paths: &StatePaths) -> Result<Option<ChannelsState>> {
    read_json_file(&paths.channels_json)
}

pub fn write_channels_state(paths: &StatePaths, state: &ChannelsState) -> Result<()> {
    paths.ensure()?;
    write_json_file(&paths.channels_json, state)
}

pub fn read_tray_record(paths: &StatePaths) -> Result<Option<TrayRecord>> {
    read_json_file(&paths.tray_json)
}

pub fn write_tray_record(paths: &StatePaths, record: &TrayRecord) -> Result<()> {
    paths.ensure()?;
    write_json_file(&paths.tray_json, record)
}

pub fn remove_tray_record(paths: &StatePaths) -> Result<()> {
    if paths.tray_json.exists() {
        fs::remove_file(&paths.tray_json)
            .with_context(|| format!("remove {}", paths.tray_json.display()))?;
    }
    Ok(())
}

fn read_json_file<T>(path: &Path) -> Result<Option<T>>
where
    T: for<'de> Deserialize<'de>,
{
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
    let value =
        serde_json::from_str(&content).with_context(|| format!("parse {}", path.display()))?;
    Ok(Some(value))
}

fn write_json_file<T>(path: &Path, value: &T) -> Result<()>
where
    T: Serialize,
{
    let content = serde_json::to_string_pretty(value)?;
    fs::write(path, format!("{content}\n")).with_context(|| format!("write {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_state_paths() -> StatePaths {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        StatePaths::from_root(std::env::temp_dir().join(format!(
            "autohand-squad-state-test-{}-{nonce}",
            std::process::id()
        )))
    }

    #[test]
    fn creates_expected_state_layout_and_device_id() {
        let paths = temp_state_paths();

        let device_id = ensure_device_id(&paths).unwrap();

        assert!(paths.bin_dir.is_dir());
        assert!(paths.queue_dir.is_dir());
        assert!(paths.runs_dir.is_dir());
        assert_eq!(device_id, fs::read_to_string(paths.device_id).unwrap());
        let _ = fs::remove_dir_all(paths.root);
    }

    #[test]
    fn channels_state_round_trips_and_defaults_auto_mode_off() {
        let paths = temp_state_paths();

        assert_eq!(read_channels_state(&paths).unwrap(), None);

        // Legacy/partial records omit autoModeDefault, memberIds, and thread
        // flags; deserialization must fall back to auto mode OFF.
        fs::create_dir_all(&paths.root).unwrap();
        fs::write(
            &paths.channels_json,
            r#"{
                "channels": [{ "id": "channel_general", "name": "general" }],
                "threads": [{ "id": "thread_1", "channelId": "channel_general" }]
            }"#,
        )
        .unwrap();
        let state = read_channels_state(&paths).unwrap().unwrap();
        assert_eq!(state.channels.len(), 1);
        assert_eq!(state.channels[0].visibility, "public");
        assert!(!state.channels[0].auto_mode_default);
        assert!(state.channels[0].member_ids.is_empty());
        assert_eq!(state.threads.len(), 1);
        assert!(!state.threads[0].auto_mode);
        assert!(!state.threads[0].self_judge);

        write_channels_state(&paths, &state).unwrap();
        assert_eq!(read_channels_state(&paths).unwrap().unwrap(), state);
        let _ = fs::remove_dir_all(paths.root);
    }
}
