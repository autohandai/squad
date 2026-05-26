use crate::state::{now_string, StatePaths};
use crate::VERSION;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::Write;

pub const SQUAD_CLIENT_TYPE: &str = "squad";
pub const LAUNCHER_CLIENT_TYPE: &str = "cli";
pub const DAEMON_SURFACE: &str = "squad-daemon";
pub const LAUNCHER_SURFACE: &str = "squad-launcher";
pub const UI_SURFACE: &str = "squad-tray";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryEvent {
    pub event: String,
    pub timestamp: Option<String>,
    pub client_type: Option<String>,
    pub surface: Option<String>,
    pub version: Option<String>,
    pub device_id: Option<String>,
    pub metadata: Option<Value>,
}

impl TelemetryEvent {
    pub fn new(event: impl Into<String>) -> Self {
        Self {
            event: event.into(),
            timestamp: None,
            client_type: None,
            surface: None,
            version: None,
            device_id: None,
            metadata: None,
        }
    }

    pub fn with_metadata(mut self, metadata: Value) -> Self {
        self.metadata = Some(metadata);
        self
    }
}

pub fn daemon_event(
    event: impl Into<String>,
    device_id: &str,
    metadata: Option<Value>,
) -> TelemetryEvent {
    let mut event = TelemetryEvent::new(event);
    event.client_type = Some(SQUAD_CLIENT_TYPE.to_string());
    event.surface = Some(DAEMON_SURFACE.to_string());
    event.version = Some(VERSION.to_string());
    event.device_id = Some(device_id.to_string());
    event.metadata = metadata;
    event
}

pub fn launcher_event(event: impl Into<String>, metadata: Option<Value>) -> TelemetryEvent {
    let mut event = TelemetryEvent::new(event);
    event.client_type = Some(LAUNCHER_CLIENT_TYPE.to_string());
    event.surface = Some(LAUNCHER_SURFACE.to_string());
    event.version = Some(VERSION.to_string());
    event.metadata = metadata;
    event
}

pub fn ui_event(
    event: impl Into<String>,
    device_id: Option<&str>,
    metadata: Option<Value>,
) -> TelemetryEvent {
    let mut event = TelemetryEvent::new(event);
    event.client_type = Some(SQUAD_CLIENT_TYPE.to_string());
    event.surface = Some(UI_SURFACE.to_string());
    event.version = Some(VERSION.to_string());
    event.device_id = device_id.map(ToString::to_string);
    event.metadata = metadata;
    event
}

pub fn append_telemetry_event(paths: &StatePaths, mut event: TelemetryEvent) -> Result<()> {
    paths.ensure()?;
    if event.timestamp.is_none() {
        event.timestamp = Some(now_string());
    }
    if event.version.is_none() {
        event.version = Some(VERSION.to_string());
    }

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.telemetry_log)
        .with_context(|| format!("open {}", paths.telemetry_log.display()))?;
    let line = serde_json::to_string(&event)?;
    writeln!(file, "{line}").with_context(|| format!("write {}", paths.telemetry_log.display()))?;
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
            "autohand-squad-telemetry-test-{}-{nonce}",
            std::process::id()
        )))
    }

    #[test]
    fn daemon_events_include_squad_client_type_and_surface() {
        let paths = temp_state_paths();
        append_telemetry_event(
            &paths,
            daemon_event(
                "daemon.heartbeat",
                "device-1",
                Some(serde_json::json!({ "activeWork": 2 })),
            ),
        )
        .unwrap();

        let content = fs::read_to_string(&paths.telemetry_log).unwrap();
        assert!(content.contains("\"clientType\":\"squad\""));
        assert!(content.contains("\"surface\":\"squad-daemon\""));
        assert!(content.contains("\"deviceId\":\"device-1\""));
        assert!(content.contains("\"activeWork\":2"));
        let _ = fs::remove_dir_all(paths.root);
    }

    #[test]
    fn launcher_events_keep_cli_client_type_and_squad_launcher_surface() {
        let paths = temp_state_paths();
        append_telemetry_event(
            &paths,
            launcher_event(
                "launcher.start",
                Some(serde_json::json!({ "command": "start" })),
            ),
        )
        .unwrap();

        let content = fs::read_to_string(&paths.telemetry_log).unwrap();
        assert!(content.contains("\"clientType\":\"cli\""));
        assert!(content.contains("\"surface\":\"squad-launcher\""));
        assert!(content.contains("\"command\":\"start\""));
        let _ = fs::remove_dir_all(paths.root);
    }
}
