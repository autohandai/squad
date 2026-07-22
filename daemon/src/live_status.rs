use crate::state::StatePaths;
use serde::{Deserialize, Serialize};
use std::fs;
use std::time::Duration;

pub const LIVE_STATUS_MAX_AGE: Duration = Duration::from_secs(90);

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LiveStatusSnapshot {
    pub source: Option<String>,
    pub updated_at: Option<String>,
    pub last_activity_at: Option<String>,
    pub current_route: Option<String>,
    #[serde(default)]
    pub online_members: usize,
    #[serde(default)]
    pub working_agents: usize,
    #[serde(default)]
    pub queued_jobs: usize,
    #[serde(default)]
    pub scheduled_jobs: usize,
    #[serde(default)]
    pub active_work: usize,
    #[serde(default)]
    pub queue_depth: usize,
    #[serde(default)]
    pub total_runs: usize,
    #[serde(default)]
    pub members: Vec<LiveStatusMember>,
    #[serde(default)]
    pub jobs: Vec<LiveStatusJob>,
    #[serde(default)]
    pub automations: Vec<LiveStatusAutomation>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LiveStatusMember {
    pub id: String,
    pub name: String,
    pub role: Option<String>,
    pub status: String,
    #[serde(default)]
    pub working: bool,
    #[serde(default)]
    pub queued_jobs: usize,
    #[serde(default)]
    pub scheduled_jobs: usize,
    pub last_activity_at: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LiveStatusJob {
    pub id: String,
    pub title: String,
    pub status: String,
    pub agent_id: Option<String>,
    pub agent_name: Option<String>,
    pub source: Option<String>,
    pub workspace: Option<String>,
    pub scheduled_for: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LiveStatusAutomation {
    pub id: String,
    pub name: String,
    pub status: String,
    pub agent_id: Option<String>,
    pub agent_name: Option<String>,
    pub trigger_type: Option<String>,
    pub schedule: Option<String>,
    pub workspace: Option<String>,
    pub updated_at: Option<String>,
}

pub fn read_live_status_snapshot(paths: &StatePaths) -> Option<LiveStatusSnapshot> {
    let content = fs::read_to_string(&paths.web_status_json).ok()?;
    serde_json::from_str(&content).ok()
}

pub fn read_fresh_live_status_snapshot(paths: &StatePaths) -> Option<LiveStatusSnapshot> {
    let modified = fs::metadata(&paths.web_status_json).ok()?.modified().ok()?;
    if modified.elapsed().ok()? > LIVE_STATUS_MAX_AGE {
        return None;
    }
    read_live_status_snapshot(paths)
}
